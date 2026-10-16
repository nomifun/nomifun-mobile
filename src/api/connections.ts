import { useSyncExternalStore } from 'react';
import { api } from './client';
import { connectionStore } from './connection';
import { CLIENT_CONNECTION_PROTOCOL, assertDesktopIdentity, requireSecureConnectionAddress, validateDesktopInfo, validateSystemInfo } from './connection-contract';
import { ApiError, StaleConnectionError, type DesktopConnectionInfo } from './types';

export { CLIENT_CONNECTION_PROTOCOL };
export async function fetchDesktopInfo(baseUrl: string, expectedEpoch: number): Promise<DesktopConnectionInfo> {
  requireSecureConnectionAddress(baseUrl);
  const desktop = validateDesktopInfo(await api('/api/connections/info', { baseUrl, token: '', timeoutMs: 6000, credentials: 'omit', expectedEpoch }));
  if (connectionStore.epoch() !== expectedEpoch) throw new StaleConnectionError();
  return desktop;
}

export type HealthState = { phase: 'idle' | 'checking' | 'ready' | 'offline' | 'blocked'; checkedAt?: number; errorCode?: string };
let health: HealthState = { phase: 'idle' };
const listeners = new Set<() => void>();
const set = (state: HealthState) => { health = state; for (const listener of [...listeners]) listener(); };
let pending: { epoch: number; promise: Promise<number> } | undefined;

export function useConnectionHealth() {
  return useSyncExternalStore(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; }, () => health, () => health);
}

/** Validate public target identity before sending a saved credential to that path. */
export async function verifyConnection(expectedEpoch = connectionStore.epoch()): Promise<number> {
  if (connectionStore.epoch() !== expectedEpoch) throw new StaleConnectionError();
  const binding = connectionStore.binding();
  if (!binding) { set({ phase: 'idle' }); return expectedEpoch; }
  const epoch = expectedEpoch;
  if (pending?.epoch === epoch) return pending.promise;
  set({ phase: 'checking', checkedAt: health.checkedAt });
  const promise = (async () => {
    try {
      if (!binding.desktop) throw new ApiError('The saved credential has no Desktop identity; pair again', 409, 'DESKTOP_IDENTITY_UNAVAILABLE');
      const desktop = await fetchDesktopInfo(binding.baseUrl, epoch);
      assertDesktopIdentity(binding.desktop, desktop);
      if (connectionStore.epoch() !== epoch) throw new StaleConnectionError();
      const system = validateSystemInfo(await api('/api/system/info', { baseUrl: binding.baseUrl, token: binding.token, timeoutMs: 6000, expectedEpoch: epoch }));
      const verifiedEpoch = await connectionStore.verify(desktop, system, epoch);
      if (verifiedEpoch === false || connectionStore.epoch() !== verifiedEpoch) throw new StaleConnectionError();
      set({ phase: 'ready', checkedAt: Date.now() });
      return verifiedEpoch;
    } catch (error) {
      if (error instanceof StaleConnectionError || connectionStore.epoch() !== epoch) throw new StaleConnectionError();
      const code = error instanceof ApiError ? error.code : undefined;
      const blocked = error instanceof ApiError && [409, 426].includes(error.status);
      if (blocked) {
        const wasVerified = connectionStore.verified();
        if (!(await connectionStore.block(epoch)) || connectionStore.epoch() !== epoch + Number(wasVerified)) throw new StaleConnectionError();
      }
      set({ phase: blocked ? 'blocked' : 'offline', checkedAt: Date.now(), errorCode: code });
      throw error;
    }
  })();
  pending = { epoch, promise };
  try { return await promise; } finally { if (pending?.promise === promise) pending = undefined; }
}

export async function changeConnectionRoute(baseUrl: string, kind: 'direct' | 'relay', expectedEpoch: number): Promise<number> {
  if (connectionStore.epoch() !== expectedEpoch) throw new StaleConnectionError();
  const binding = connectionStore.binding();
  if (!binding?.desktop) throw new ApiError('Pair with a Desktop first', 409, 'DESKTOP_IDENTITY_UNAVAILABLE');
  const epoch = expectedEpoch;
  const desktop = await fetchDesktopInfo(baseUrl, epoch);
  assertDesktopIdentity(binding.desktop, desktop);
  // A route must authenticate and report a valid namespace before it replaces the working route.
  validateSystemInfo(await api('/api/system/info', { baseUrl, token: binding.token, timeoutMs: 6000, expectedEpoch: epoch }));
  if (!(await connectionStore.selectRoute(baseUrl, kind, epoch))) throw new StaleConnectionError();
  return verifyConnection(epoch + 1);
}

export async function revokeCurrentDevice(expectedEpoch: number): Promise<void> {
  const epoch = expectedEpoch;
  await api('/api/connections/device', { method: 'DELETE', timeoutMs: 8000, expectedEpoch: epoch });
  await connectionStore.disconnect(undefined, epoch);
}
