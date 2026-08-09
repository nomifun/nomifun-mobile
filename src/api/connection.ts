/**
 * Connection store — the single source of truth for "which desktop server are
 * we bound to and with what credentials". Persisted via AsyncStorage
 * (localStorage on web), consumed by React through useSyncExternalStore.
 *
 * On web the app is always same-origin with the server (dev proxy or served
 * by nomifun itself), so baseUrl is forced to ''.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import type { AuthUser, ServerBinding } from './types';
import { randomHex } from './utils';

const STORAGE_KEY = 'nomifun.connection.v1';

export type ConnectionState =
  | { phase: 'loading' }
  | { phase: 'disconnected'; lastBaseUrl?: string }
  | { phase: 'connected'; binding: ServerBinding };

let state: ConnectionState = { phase: 'loading' };
const listeners = new Set<() => void>();

function emit() {
  for (const l of Array.from(listeners)) l();
}

function setState(next: ConnectionState) {
  state = next;
  emit();
}

export const connectionStore = {
  getState(): ConnectionState {
    return state;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Load the persisted binding once at startup. */
  async hydrate(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) {
        setState({ phase: 'disconnected' });
        return;
      }
      const parsed = JSON.parse(raw) as ServerBinding & { lastBaseUrl?: string };
      if (parsed.token) {
        const binding: ServerBinding = {
          baseUrl: Platform.OS === 'web' ? '' : parsed.baseUrl,
          token: parsed.token,
          user: parsed.user ?? null,
          csrfToken: parsed.csrfToken || randomHex(),
          contractVersion: parsed.contractVersion,
        };
        setState({ phase: 'connected', binding });
      } else {
        setState({ phase: 'disconnected', lastBaseUrl: parsed.baseUrl || undefined });
      }
    } catch {
      setState({ phase: 'disconnected' });
    }
  },

  /** Persist a successful login. */
  async connect(binding: Omit<ServerBinding, 'csrfToken'> & { csrfToken?: string }): Promise<void> {
    const full: ServerBinding = {
      ...binding,
      baseUrl: Platform.OS === 'web' ? '' : binding.baseUrl,
      csrfToken: binding.csrfToken || randomHex(),
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(full));
    setState({ phase: 'connected', binding: full });
  },

  /** Replace the JWT after POST /api/auth/refresh. */
  async updateToken(token: string): Promise<void> {
    if (state.phase !== 'connected') return;
    const binding = { ...state.binding, token };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(binding));
    setState({ phase: 'connected', binding });
  },

  async updateUser(user: AuthUser): Promise<void> {
    if (state.phase !== 'connected') return;
    const binding = { ...state.binding, user };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(binding));
    setState({ phase: 'connected', binding });
  },

  /** Drop credentials but remember the address for the reconnect form. */
  async disconnect(): Promise<void> {
    const lastBaseUrl = state.phase === 'connected' ? state.binding.baseUrl : undefined;
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ baseUrl: lastBaseUrl ?? '', token: '', user: null, csrfToken: '' }),
    );
    setState({ phase: 'disconnected', lastBaseUrl });
  },

  /** Server told us the JWT is dead (403 FORBIDDEN). */
  markAuthExpired(): void {
    if (state.phase !== 'connected') return;
    const lastBaseUrl = state.binding.baseUrl;
    void AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ baseUrl: lastBaseUrl, token: '', user: null, csrfToken: '' }),
    );
    setState({ phase: 'disconnected', lastBaseUrl });
  },

  /** Current binding or null; convenience for non-React callers. */
  binding(): ServerBinding | null {
    return state.phase === 'connected' ? state.binding : null;
  },
};
