/**
 * WebSocket client for the nomifun realtime channel.
 *
 * Protocol (docs/research/ws-protocol.md):
 * - URL: `${baseUrl → ws(s)}/ws`, JWT passed as the WebSocket subprotocol
 *   (browser WS cannot set headers; the server accepts the first
 *   Sec-WebSocket-Protocol value and echoes it back).
 * - Envelope both directions: `{ "name": "<topic>", "data": <payload> }`.
 * - Server sends `ping`; the client MUST answer `pong` or the server closes
 *   the socket with 4408 after 60s.
 * - There is NO replay on reconnect: after every reconnect we emit the
 *   synthetic local topic `ws.reconnected` so features refetch their state.
 * - A 75s staleness watchdog guards against half-open sockets (mobile
 *   backgrounding produces sockets that report OPEN forever).
 */
import { AppState, Platform, type AppStateStatus } from 'react-native';

import { connectionStore } from './connection';

export type WsStatus = 'idle' | 'connecting' | 'open' | 'reconnecting';

interface Envelope {
  name?: string;
  event?: string;
  data?: unknown;
  payload?: unknown;
}

type TopicHandler = (data: unknown) => void;

const STALE_MS = 75_000;
const MAX_BACKOFF_MS = 15_000;

function socketUrl(baseUrl: string): string {
  if (Platform.OS === 'web') {
    const location = globalThis.location;
    if (!location?.host) {
      throw new Error('WebSocket location is unavailable');
    }
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}/ws`;
  }
  return `${baseUrl.replace(/^http/, 'ws')}/ws`;
}

class NomifunSocket {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<TopicHandler>>();
  private statusListeners = new Set<(s: WsStatus) => void>();
  private status: WsStatus = 'idle';
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private lastActivity = 0;
  private wasConnectedOnce = false;
  private started = false;

  constructor() {
    connectionStore.subscribe(() => this.onBindingChanged());
    AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active' && this.started) this.ensureFresh();
    });
  }

  /** Begin maintaining a connection for the lifetime of the app session. */
  start() {
    this.started = true;
    this.open();
  }

  stop() {
    this.started = false;
    this.teardown();
    this.setStatus('idle');
  }

  getStatus(): WsStatus {
    return this.status;
  }

  onStatus(listener: (s: WsStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Subscribe to a wire topic (or the synthetic 'ws.reconnected'). */
  on(topic: string, handler: TopicHandler): () => void {
    let set = this.handlers.get(topic);
    if (!set) {
      set = new Set();
      this.handlers.set(topic, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(topic);
    };
  }

  private setStatus(next: WsStatus) {
    if (this.status === next) return;
    this.status = next;
    for (const l of Array.from(this.statusListeners)) l(next);
  }

  private onBindingChanged() {
    if (!this.started) return;
    // Credentials changed (login/logout) — drop and rebuild.
    this.teardown();
    this.open();
  }

  private teardown() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try {
        ws.close();
      } catch {
        // already dead
      }
    }
  }

  private open() {
    const binding = connectionStore.binding();
    if (!this.started || !binding) {
      this.setStatus('idle');
      return;
    }
    this.teardown();
    this.setStatus(this.wasConnectedOnce ? 'reconnecting' : 'connecting');

    let ws: WebSocket;
    try {
      // H5 must use an absolute same-origin URL; browser WebSocket rejects
      // a relative value such as "/ws". The dev/production proxy then keeps
      // HTTP and WebSocket on the same origin.
      const url = socketUrl(binding.baseUrl);
      // JWT as subprotocol: works on browsers and RN alike.
      ws = new WebSocket(url, [binding.token]);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.lastActivity = Date.now();

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.reconnectAttempt = 0;
      this.lastActivity = Date.now();
      this.setStatus('open');
      this.startStaleWatchdog();
      if (this.wasConnectedOnce) this.dispatch('ws.reconnected', null);
      this.wasConnectedOnce = true;
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      this.lastActivity = Date.now();
      let envelope: Envelope;
      try {
        envelope = JSON.parse(String(event.data)) as Envelope;
      } catch {
        return;
      }
      const topic = envelope.name ?? envelope.event;
      if (!topic) return;
      if (topic === 'ping') {
        // Keep the heartbeat envelope compatible with the desktop contract:
        // echo the server timestamp when present, and still produce a useful
        // timestamp for older/defensive servers that omit it.
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
      this.dispatch(topic, envelope.data ?? envelope.payload ?? null);
    };

    ws.onerror = () => {
      if (this.ws !== ws) return;
      // onclose follows; nothing to do here.
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.scheduleReconnect();
    };
  }

  private dispatch(topic: string, data: unknown) {
    const set = this.handlers.get(topic);
    if (set) for (const h of Array.from(set)) h(data);
    const anySet = this.handlers.get('*');
    if (anySet) for (const h of Array.from(anySet)) h({ topic, data });
  }

  send(name: string, data: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ name, data }));
      } catch {
        // socket died mid-send; watchdog will recover
      }
    }
  }

  private startStaleWatchdog() {
    if (this.staleTimer) clearInterval(this.staleTimer);
    this.staleTimer = setInterval(() => {
      if (Date.now() - this.lastActivity > STALE_MS) {
        // Half-open socket — force a rebuild.
        this.open();
      }
    }, 15_000);
  }

  private ensureFresh() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.open();
      return;
    }
    if (Date.now() - this.lastActivity > STALE_MS) this.open();
  }

  private scheduleReconnect() {
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
    if (!this.started || !connectionStore.binding()) {
      this.setStatus('idle');
      return;
    }
    this.setStatus('reconnecting');
    const backoff = Math.min(1000 * 2 ** this.reconnectAttempt, MAX_BACKOFF_MS);
    const jitter = backoff * (0.8 + Math.random() * 0.4);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.open(), jitter);
  }
}

export const nomifunSocket = new NomifunSocket();
