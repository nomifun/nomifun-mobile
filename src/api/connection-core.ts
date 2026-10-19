import type { AuthUser, DesktopConnectionInfo, DesktopSystemInfo, ServerBinding } from './types';
import { connectionNamespace } from './connection-contract';

export type ConnectionState =
  | { phase: 'loading'; epoch: number }
  | { phase: 'disconnected'; epoch: number; lastBaseUrl?: string }
  | { phase: 'connected'; epoch: number; verified: boolean; binding: ServerBinding };

export interface ConnectionPersistence {
  read(): Promise<ServerBinding | null>;
  write(value: ServerBinding): Promise<void>;
}

/** Credential writes and namespace changes share one serialized owner. */
export function createConnectionStore(persistence: ConnectionPersistence, sameOrigin = false) {
  let state: ConnectionState = { phase: 'loading', epoch: 0 };
  let queue: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  const set = (next: ConnectionState) => { state = next; for (const listener of [...listeners]) listener(); };
  const run = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation, operation); queue = next.then(() => undefined, () => undefined); return next;
  };
  const active = () => state.phase === 'connected' ? state.binding : null;
  const normalize = (binding: ServerBinding): ServerBinding => ({ ...binding, baseUrl: sameOrigin ? '' : binding.baseUrl });
  const clear = async (expectedToken?: string, expectedEpoch?: number) => run(async () => {
    if (expectedEpoch !== undefined && state.epoch !== expectedEpoch) return;
    const current = active();
    if (expectedToken && current?.token !== expectedToken) return;
    const lastBaseUrl = current?.baseUrl;
    set({ phase: 'disconnected', epoch: state.epoch + 1, lastBaseUrl });
    await persistence.write({ baseUrl: lastBaseUrl ?? '', token: '', user: null });
  });
  return {
    getState: () => state,
    epoch: () => state.epoch,
    verified: () => state.phase === 'connected' && state.verified,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    binding: active,
    async hydrate() {
      try {
        const persisted = await persistence.read();
        if (persisted?.token) set({ phase: 'connected', epoch: state.epoch + 1, verified: false, binding: normalize(persisted) });
        else set({ phase: 'disconnected', epoch: state.epoch + 1, lastBaseUrl: persisted?.baseUrl || undefined });
      } catch { set({ phase: 'disconnected', epoch: state.epoch + 1 }); }
    },
    async connect(binding: ServerBinding, verified = true, expectedEpoch?: number) {
      return run(async () => {
        if (expectedEpoch !== undefined && state.epoch !== expectedEpoch) return false;
        const full = normalize(binding); await persistence.write(full);
        set({ phase: 'connected', epoch: state.epoch + 1, verified, binding: full });
        return true;
      });
    },
    async verify(desktop: DesktopConnectionInfo, system: DesktopSystemInfo, expectedEpoch: number) {
      return run(async () => {
        if (state.phase !== 'connected' || state.epoch !== expectedEpoch) return false;
        const before = state.binding;
        const binding = { ...before, desktop, system };
        const changed = connectionNamespace(before) !== connectionNamespace(binding);
        await persistence.write(binding);
        const epoch = state.epoch + Number(changed);
        set({ phase: 'connected', verified: true, binding, epoch });
        // Return this operation's receipt, never an epoch read after awaiting it:
        // another queued connection may commit before the caller resumes.
        return epoch;
      });
    },
    async block(expectedEpoch: number) {
      return run(async () => {
        if (state.phase !== 'connected' || state.epoch !== expectedEpoch) return false;
        if (state.verified) set({ ...state, epoch: state.epoch + 1, verified: false });
        return true;
      });
    },
    async updateToken(token: string, expectedToken?: string, expectedEpoch?: number) {
      return run(async () => {
        if (expectedEpoch !== undefined && state.epoch !== expectedEpoch) return false;
        if (state.phase !== 'connected' || (expectedToken !== undefined && state.binding.token !== expectedToken)) return false;
        const binding = { ...state.binding, token }; await persistence.write(binding); set({ ...state, binding }); return true;
      });
    },
    async updateUser(user: AuthUser) {
      const token = active()?.token;
      await run(async () => {
        if (state.phase !== 'connected' || state.binding.token !== token) return;
        const binding = { ...state.binding, user }; await persistence.write(binding); set({ ...state, binding });
      });
    },
    async selectRoute(baseUrl: string, kind: 'direct' | 'relay', expectedEpoch: number) {
      return run(async () => {
        if (sameOrigin || state.phase !== 'connected' || state.epoch !== expectedEpoch) return false;
        const previous = state.binding;
        const routes = [...(previous.routes ?? [{ baseUrl: previous.baseUrl, kind: previous.routeKind ?? 'direct' }])]
          .filter(route => route.baseUrl !== baseUrl);
        routes.push({ baseUrl, kind });
        const binding = { ...previous, baseUrl, routeKind: kind, routes: routes.slice(-4) };
        await persistence.write(binding);
        set({ phase: 'connected', epoch: state.epoch + 1, verified: false, binding }); return true;
      });
    },
    disconnect: (expectedToken?: string, expectedEpoch?: number) => clear(expectedToken ?? active()?.token, expectedEpoch),
    markAuthExpired(expectedToken: string, expectedEpoch: number) {
      // The producer owns this receipt. A route commit can already be queued
      // with the same JWT, so token equality alone cannot authorize its clear.
      void clear(expectedToken, expectedEpoch).catch(() => undefined);
    },
  };
}
