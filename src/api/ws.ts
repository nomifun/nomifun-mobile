/**
 * WebSocket client for the nomifun realtime channel.
 *
 * The server sends `{name,data}` envelopes and does not replay events. The
 * client therefore owns three pieces of reliability behavior:
 *
 * - answer application-level `ping` frames with `pong`;
 * - recycle dead/half-open sockets, including after mobile backgrounding;
 * - emit local `ws.reconnected` after a delivery gap so durable projections
 *   can refetch their authoritative snapshots.
 */
import { AppState, Platform, type AppStateStatus } from 'react-native';

import { refreshSessionToken } from './auth';
import { connectionStore } from './connection';
import { sessionTokenRefreshDelayMs } from './session-token';
import { ApiError, AuthExpiredError } from './types';
import { verifyConnection } from './connections';

export type WsStatus = 'idle' | 'connecting' | 'open' | 'reconnecting';

interface Envelope {
  name?: string;
  event?: string;
  data?: unknown;
  payload?: unknown;
}

type TopicHandler = (data: unknown) => void;

const STALE_MS = 75_000;
const WATCHDOG_INTERVAL_MS = 15_000;
const CONNECT_TIMEOUT_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;
const WS_CLOSE_TOKEN_AGED = 4409;
const WS_CLOSE_HEARTBEAT_TIMEOUT = 4408;
const WS_RESYNC_JITTER_MAX_MS = 2_000;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
const TOKEN_REFRESH_RETRY_BASE_MS = 60_000;
const TOKEN_REFRESH_RETRY_MAX_MS = 6 * 60 * 60_000;

function isTerminalTokenRefreshError(error: unknown): boolean {
  return (
    error instanceof AuthExpiredError ||
    (error instanceof ApiError && error.status === 401)
  );
}

function socketUrl(baseUrl: string): string {
  if (Platform.OS === 'web') {
    const location = globalThis.location;
    if (!location?.host) throw new Error('WebSocket location is unavailable');
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}/ws`;
  }
  const normalized = baseUrl.replace(/\/+$/, '');
  const wsBase = normalized.startsWith('https://')
    ? `wss://${normalized.slice('https://'.length)}`
    : normalized.startsWith('http://')
      ? `ws://${normalized.slice('http://'.length)}`
      : normalized;
  return `${wsBase}/ws`;
}

class NomifunSocket {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<TopicHandler>>();
  private statusListeners = new Set<(status: WsStatus) => void>();
  private status: WsStatus = 'idle';
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private resyncTimer: ReturnType<typeof setTimeout> | null = null;
  private tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private tokenRefreshPromise: Promise<void> | null = null;
  private tokenRefreshRetryAttempt = 0;
  private waitingForFreshToken = false;
  private waitingToken = '';
  private lastActivity = 0;
  private connectStartedAt = 0;
  private hadDeliveryGap = false;
  private started = false;
  private bindingKey = '';
  private validation: Promise<void> | null = null;

  constructor() {
    connectionStore.subscribe(() => this.onBindingChanged());
    AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status === 'active' && this.started) {
        void verifyConnection().then(() => {
          if (this.started) { this.scheduleTokenRefresh(); this.ensureFresh(); }
        }).catch(() => { this.teardown(true); this.scheduleReconnect(); });
      }
    });
  }

  /** Begin maintaining a connection for the lifetime of the app session. */
  start(): void {
    this.started = true;
    this.bindingKey = this.currentBindingKey();
    this.scheduleTokenRefresh();
    this.open();
  }

  stop(): void {
    this.started = false;
    this.teardown(false);
    this.clearTokenRefreshTimer();
    this.hadDeliveryGap = false;
    this.reconnectAttempt = 0;
    this.tokenRefreshRetryAttempt = 0;
    this.waitingForFreshToken = false;
    this.waitingToken = '';
    this.setStatus('idle');
  }

  getStatus(): WsStatus {
    return this.status;
  }

  onStatus(listener: (status: WsStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Subscribe to a wire topic or the synthetic local `ws.reconnected`. */
  on(topic: string, handler: TopicHandler): () => void {
    let set = this.handlers.get(topic);
    if (!set) {
      set = new Set();
      this.handlers.set(topic, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
      if (set?.size === 0) this.handlers.delete(topic);
    };
  }

  private setStatus(next: WsStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const listener of Array.from(this.statusListeners)) {
      try {
        listener(next);
      } catch {
        // A status observer must not break the socket lifecycle.
      }
    }
  }

  private onBindingChanged(): void {
    if (!this.started) return;
    const key = this.currentBindingKey();
    if (key === this.bindingKey) return;
    this.bindingKey = key;
    // The old socket's refresh wait belongs to its route/epoch, including when
    // the next route legitimately keeps exactly the same JWT.
    this.waitingForFreshToken = false;
    this.waitingToken = '';
    this.scheduleTokenRefresh();
    // Login/logout or a token refresh invalidates the old socket. Any frames
    // between the two connections are not replayed by the server.
    this.teardown(true);
    this.open();
  }

  private currentBindingKey(): string {
    const binding = connectionStore.binding();
    return JSON.stringify([binding?.baseUrl, binding?.token, connectionStore.epoch()]);
  }

  reconnect(): void { this.recycle('user requested reconnect', true); }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer !== null) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private clearResyncTimer(): void {
    if (this.resyncTimer !== null) {
      clearTimeout(this.resyncTimer);
      this.resyncTimer = null;
    }
  }

  private clearTokenRefreshTimer(): void {
    if (this.tokenRefreshTimer !== null) {
      clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }
  }

  private teardown(markGap: boolean): void {
    if (markGap) this.hadDeliveryGap = true;
    this.clearReconnectTimer();
    this.clearWatchdog();
    this.clearResyncTimer();
    this.connectStartedAt = 0;
    const current = this.ws;
    this.ws = null;
    if (!current) return;
    current.onopen = null;
    current.onmessage = null;
    current.onerror = null;
    current.onclose = null;
    try {
      current.close();
    } catch {
      // The platform may already have disposed the native socket.
    }
  }

  private open(): void {
    if (!this.started || !connectionStore.binding()) { this.setStatus('idle'); return; }
    if (this.ws || this.validation) return;
    this.setStatus(this.hadDeliveryGap ? 'reconnecting' : 'connecting');
    const validation = verifyConnection().then(() => {
      const connection = connectionStore.getState();
      if (this.started && connection.phase === 'connected' && connection.verified) this.openVerified();
    }).catch(() => { if (this.started) this.scheduleReconnect(); });
    this.validation = validation;
    void validation.finally(() => { if (this.validation === validation) this.validation = null; });
  }

  private openVerified(): void {
    const binding = connectionStore.binding();
    const epoch = connectionStore.epoch();
    if (!this.started || !binding) {
      this.setStatus('idle');
      return;
    }
    if (this.waitingForFreshToken) {
      this.setStatus('reconnecting');
      return;
    }
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.clearReconnectTimer();
    this.clearWatchdog();
    this.setStatus(this.hadDeliveryGap ? 'reconnecting' : 'connecting');

    let current: WebSocket;
    try {
      current = new WebSocket(socketUrl(binding.baseUrl), [binding.token]);
    } catch {
      this.hadDeliveryGap = true;
      this.scheduleReconnect();
      return;
    }

    this.ws = current;
    this.lastActivity = Date.now();
    this.connectStartedAt = Date.now();
    this.startWatchdog();

    current.onopen = () => {
      if (this.ws !== current) return;
      this.connectStartedAt = 0;
      this.lastActivity = Date.now();
      this.setStatus('open');
      // Do not reset backoff here: a server can complete the handshake and
      // immediately reject an expired token. The first inbound frame proves
      // that the connection is genuinely alive.
      if (this.hadDeliveryGap) {
        this.hadDeliveryGap = false;
        this.dispatch('ws.reconnected', undefined);
      }
    };

    current.onmessage = (event) => {
      if (this.ws !== current) return;
      this.lastActivity = Date.now();
      this.reconnectAttempt = 0;

      let envelope: Envelope;
      try {
        envelope = JSON.parse(String(event.data)) as Envelope;
      } catch {
        return;
      }
      const topic = envelope.name ?? envelope.event;
      if (!topic) return;

      if (topic === 'ping') {
        const timestamp =
          envelope.data &&
          typeof envelope.data === 'object' &&
          'timestamp' in envelope.data &&
          typeof (envelope.data as { timestamp?: unknown }).timestamp === 'number'
            ? (envelope.data as { timestamp: number }).timestamp
            : Date.now();
        this.send('pong', { timestamp });
        return;
      }

      if (topic === 'sync.resync-required') {
        this.scheduleResync();
        return;
      }

      this.dispatch(topic, envelope.data ?? envelope.payload ?? null);
    };

    current.onerror = () => {
      if (this.ws !== current) return;
      // The close callback owns reconnect scheduling.
    };

    current.onclose = (event) => {
      if (this.ws !== current) return;
      this.ws = null;
      this.connectStartedAt = 0;
      this.hadDeliveryGap = true;
      this.clearWatchdog();

      if (event.code === 1008) {
        // 1008 is the desktop's auth-policy rejection. 4408 is only a
        // heartbeat timeout and must not log the user out.
        connectionStore.markAuthExpired(binding.token, epoch);
        this.reconnectAttempt = Math.max(this.reconnectAttempt, 5);
      } else if (event.code === WS_CLOSE_TOKEN_AGED) {
        // Browser sessions slide through cookies; native sessions need an
        // explicit Bearer refresh before the next handshake. Normally the
        // half-life timer has already renewed it; this path covers suspended
        // apps and expiry races.
        this.reconnectAttempt = 0;
        this.refreshTokenAndReconnect(true);
        return;
      } else if (event.code === WS_CLOSE_HEARTBEAT_TIMEOUT) {
        // Plain reconnect; the token is still valid.
      }
      this.scheduleReconnect();
    };
  }

  private dispatch(topic: string, data: unknown): void {
    const set = this.handlers.get(topic);
    if (set) {
      for (const handler of Array.from(set)) {
        try {
          handler(data);
        } catch {
          // One feature's malformed event must not stop other subscribers.
        }
      }
    }
    const anySet = this.handlers.get('*');
    if (anySet) {
      for (const handler of Array.from(anySet)) {
        try {
          handler({ topic, data });
        } catch {
          // See above.
        }
      }
    }
  }

  send(name: string, data: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ name, data }));
    } catch {
      // The watchdog/close path will recover a socket that dies mid-send.
    }
  }

  private startWatchdog(): void {
    this.clearWatchdog();
    this.watchdogTimer = setInterval(() => {
      if (!this.started || !this.ws) return;
      const now = Date.now();
      const stuckConnecting =
        this.ws.readyState === WebSocket.CONNECTING &&
        this.connectStartedAt > 0 &&
        now - this.connectStartedAt > CONNECT_TIMEOUT_MS;
      const staleOpen =
        this.ws.readyState === WebSocket.OPEN &&
        now - this.lastActivity > STALE_MS;
      if (stuckConnecting || staleOpen) {
        this.recycle(
          stuckConnecting ? 'handshake timeout' : 'stale open socket',
        );
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  private recycle(reason: string, immediate = false): void {
    void reason;
    this.hadDeliveryGap = true;
    const current = this.ws;
    this.ws = null;
    this.connectStartedAt = 0;
    if (current) {
      current.onopen = null;
      current.onmessage = null;
      current.onerror = null;
      current.onclose = null;
      try {
        current.close();
      } catch {
        // Ignore platform close races.
      }
    }
    this.clearWatchdog();
    if (immediate) {
      this.reconnectAttempt = 0;
      this.open();
    } else {
      this.scheduleReconnect();
    }
  }

  private ensureFresh(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.recycle('foreground socket unavailable', true);
      return;
    }
    if (Date.now() - this.lastActivity > STALE_MS) {
      this.recycle('foreground socket stale', true);
    }
  }

  private scheduleResync(): void {
    if (this.resyncTimer !== null) return;
    this.resyncTimer = setTimeout(() => {
      this.resyncTimer = null;
      this.dispatch('ws.reconnected', undefined);
    }, Math.floor(Math.random() * WS_RESYNC_JITTER_MAX_MS));
  }

  private scheduleReconnect(): void {
    this.clearWatchdog();
    if (!this.started || !connectionStore.binding()) {
      this.setStatus('idle');
      return;
    }
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    if (this.reconnectTimer !== null) return;
    this.setStatus('reconnecting');
    const delay = Math.min(
      1000 * 2 ** this.reconnectAttempt,
      MAX_BACKOFF_MS,
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private scheduleTokenRefresh(delayOverride?: number): void {
    this.clearTokenRefreshTimer();
    const binding = connectionStore.binding();
    if (!this.started || !binding) return;

    const delay =
      delayOverride ?? sessionTokenRefreshDelayMs(binding.token);
    if (delay === undefined) return;
    const boundedDelay = Math.min(
      Math.max(0, delay),
      MAX_TIMER_DELAY_MS,
    );
    this.tokenRefreshTimer = setTimeout(() => {
      this.tokenRefreshTimer = null;
      if (delay > MAX_TIMER_DELAY_MS) {
        this.scheduleTokenRefresh();
        return;
      }
      this.refreshTokenAndReconnect();
    }, boundedDelay);
  }

  private scheduleTokenRefreshRetry(): void {
    const exponent = Math.min(this.tokenRefreshRetryAttempt, 8);
    const delay = Math.min(
      TOKEN_REFRESH_RETRY_BASE_MS * 2 ** exponent,
      TOKEN_REFRESH_RETRY_MAX_MS,
    );
    this.tokenRefreshRetryAttempt += 1;
    this.scheduleTokenRefresh(delay);
  }

  private refreshTokenAndReconnect(requireFreshToken = false): void {
    const refreshEpoch = connectionStore.epoch();
    if (requireFreshToken) {
      this.waitingForFreshToken = true;
      this.waitingToken = connectionStore.binding()?.token ?? '';
    }
    if (this.tokenRefreshPromise) return;
    this.clearTokenRefreshTimer();
    const refreshToken =
      connectionStore.binding()?.token ?? this.waitingToken;
    this.tokenRefreshPromise = refreshSessionToken()
      .then(() => {
        if (connectionStore.epoch() !== refreshEpoch) return;
        this.waitingForFreshToken = false;
        this.waitingToken = '';
        this.tokenRefreshRetryAttempt = 0;
        this.scheduleTokenRefresh();
        this.open();
      })
      .catch((error: unknown) => {
        if (connectionStore.epoch() !== refreshEpoch) return;
        if (isTerminalTokenRefreshError(error)) {
          this.waitingForFreshToken = false;
          this.waitingToken = '';
          connectionStore.markAuthExpired(refreshToken, refreshEpoch);
          return;
        }
        if (!this.started || !connectionStore.binding()) return;
        if (!this.ws) this.setStatus('reconnecting');
        this.scheduleTokenRefreshRetry();
      })
      .finally(() => {
        this.tokenRefreshPromise = null;
        // A route may have requested its own refresh while this old owner held
        // the single-flight slot. Release that slot before servicing the new
        // owner's intent; never publish this operation's stale receipt to it.
        if (connectionStore.epoch() !== refreshEpoch && this.started && connectionStore.binding()) {
          if (this.waitingForFreshToken) this.refreshTokenAndReconnect(true);
          else { this.scheduleTokenRefresh(); this.open(); }
        }
      });
  }
}

export const nomifunSocket = new NomifunSocket();
