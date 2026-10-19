/**
 * Auth flows against the desktop server. All of these run BEFORE a binding
 * exists, so they take explicit baseUrl arguments and pass them through to
 * rawRequest overrides.
 *
 * Device login/setup/pair endpoints are rate-limited —
 * 5 failures per 15 minutes per IP — never auto-retry a 401 here.
 */
import { rawRequest } from './client';
import { connectionStore } from './connection';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import { CLIENT_CONNECTION_PROTOCOL, fetchDesktopInfo, verifyConnection } from './connections';
import type { AuthLoginResponse, AuthStatusResponse, AuthUser, ConnectionAuthResult, DesktopConnectionInfo } from './types';
import { ApiError, AuthExpiredError, StaleConnectionError } from './types';
import { isLocalConnectionAddress } from './connection-contract';

export interface ProbeResult {
  reachable: boolean;
  needsSetup?: boolean;
  isNomifun?: boolean;
  error?: string;
}

interface RefreshResponse {
  success: boolean;
  token?: string;
}

/** Cheap unauthenticated probe to validate an address before logging in. */
export async function probeServer(baseUrl: string, expectedEpoch: number, timeoutMs = 6000): Promise<ProbeResult> {
  try {
    const status = await rawRequest<AuthStatusResponse>('/api/auth/status', {
      baseUrl,
      token: '',
      timeoutMs,
      expectedEpoch,
    });
    if (typeof status?.needs_setup !== 'boolean') {
      return { reachable: true, isNomifun: false };
    }
    return { reachable: true, isNomifun: true, needsSetup: status.needs_setup };
  } catch (err) {
    if (err instanceof StaleConnectionError) throw err;
    return { reachable: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function persistLogin(baseUrl: string, res: AuthLoginResponse, desktop: DesktopConnectionInfo, expectedEpoch: number): Promise<ConnectionAuthResult> {
  if (!res.success || !res.token) {
    throw new ApiError(res.message ?? 'Login failed', 401);
  }
  if (!res.device?.device_id) throw new ApiError('Desktop did not register this device', 426, 'CONNECTION_PROTOCOL_INCOMPATIBLE');
  if (connectionStore.epoch() !== expectedEpoch) throw new StaleConnectionError();
  const connected = await connectionStore.connect({
    baseUrl,
    token: res.token,
    user: res.user ?? null,
    desktop,
    device: res.device,
    routeKind: Platform.OS === 'web' ? 'site' : isLocalConnectionAddress(baseUrl) ? 'direct' : 'relay',
    routes: [{ baseUrl, kind: Platform.OS === 'web' ? 'site' : isLocalConnectionAddress(baseUrl) ? 'direct' : 'relay' }],
  }, false, expectedEpoch);
  if (!connected) throw new StaleConnectionError();
  // Keep the redeemed credential for an explicit retry when the network disappears here.
  // connect increments exactly once. Do not read the active epoch after this
  // await: an unrelated target may already have committed ahead of our caller.
  const epoch = await verifyConnection(expectedEpoch + 1);
  if (connectionStore.epoch() !== epoch) throw new StaleConnectionError();
  return { user: res.user ?? { user_id: '', username: '' }, epoch };
}

const deviceName = () => Array.from((Device.deviceName ?? `Nomifun ${Platform.OS}`).replace(/[\x00-\x1f\x7f]/g, '').trim()).slice(0, 80).join('') || `Nomifun ${Platform.OS}`;

/** One-shot phone ticket creates an individually revocable credential, without a browser cookie. */
export async function devicePairLogin(baseUrl: string, qrToken: string, expectedEpoch: number): Promise<ConnectionAuthResult> {
  const desktop = await fetchDesktopInfo(baseUrl, expectedEpoch);
  if (!desktop.capabilities.includes('device_pairing')) throw new ApiError('Update Desktop to pair a phone', 426, 'CONNECTION_PROTOCOL_INCOMPATIBLE');
  const res = await rawRequest<AuthLoginResponse>('/api/auth/device-pair', {
    baseUrl, token: '', method: 'POST', timeoutMs: 10_000, credentials: 'omit',
    body: { qr_token: qrToken, device_name: deviceName(), protocol_version: CLIENT_CONNECTION_PROTOCOL },
    expectedEpoch,
  });
  if (!res.device?.device_id) throw new ApiError('Desktop did not register this device', 426, 'CONNECTION_PROTOCOL_INCOMPATIBLE');
  return persistLogin(baseUrl, res, desktop, expectedEpoch);
}

/** Username/password login (manual-address fallback). */
export async function passwordLogin(
  baseUrl: string,
  username: string,
  password: string,
  expectedEpoch: number,
): Promise<ConnectionAuthResult> {
  const desktop = await fetchDesktopInfo(baseUrl, expectedEpoch);
  const res = await rawRequest<AuthLoginResponse>('/api/auth/device-login', {
    baseUrl,
    token: '',
    method: 'POST',
    body: { username, password, device_name: deviceName(), protocol_version: CLIENT_CONNECTION_PROTOCOL },
    credentials: 'omit',
    timeoutMs: 10_000,
    expectedEpoch,
  });
  return persistLogin(baseUrl, res, desktop, expectedEpoch);
}

/** First-run claim: only valid while GET /api/auth/status says needs_setup. */
export async function setupAdmin(
  baseUrl: string,
  username: string,
  password: string,
  expectedEpoch: number,
): Promise<ConnectionAuthResult> {
  const desktop = await fetchDesktopInfo(baseUrl, expectedEpoch);
  const res = await rawRequest<AuthLoginResponse>('/api/auth/device-setup', {
    baseUrl,
    token: '',
    method: 'POST',
    body: { username, password, device_name: deviceName(), protocol_version: CLIENT_CONNECTION_PROTOCOL },
    credentials: 'omit',
    timeoutMs: 10_000,
    expectedEpoch,
  });
  return persistLogin(baseUrl, res, desktop, expectedEpoch);
}

/** Blacklist the JWT server-side, then clear local state. */
export async function logout(expectedEpoch: number): Promise<void> {
  // Native confirmation dialogs can outlive the screen that opened them.
  if (connectionStore.epoch() !== expectedEpoch) return;
  const binding = connectionStore.binding();
  const epoch = expectedEpoch;
  if (!binding) return;
  try {
    await rawRequest(binding?.device ? '/api/connections/device' : '/logout',
      { method: binding?.device ? 'DELETE' : 'POST', timeoutMs: 8000, expectedEpoch: epoch });
  } catch (error) {
    if (error instanceof StaleConnectionError) return;
    // Best effort — dropping local credentials matters more than the blacklist.
  }
  await connectionStore.disconnect(undefined, epoch);
}

/** Re-fetch the current user (also serves as a session validity check). */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const res = await rawRequest<{ success: boolean; user?: AuthUser }>('/api/auth/user');
  return res.user ?? null;
}

/** Refresh a Bearer token while it is still valid and persist the replacement. */
export async function refreshSessionToken(): Promise<string> {
  const epoch = connectionStore.epoch();
  const binding = connectionStore.binding();
  if (!binding?.token) throw new AuthExpiredError();
  const response = await rawRequest<RefreshResponse>('/api/auth/refresh', {
    baseUrl: binding.baseUrl,
    token: binding.token,
    method: 'POST',
    body: { token: binding.token },
    timeoutMs: 8_000,
    expectedEpoch: epoch,
  });
  if (!response.success || !response.token) {
    throw new AuthExpiredError();
  }
  const updated = await connectionStore.updateToken(response.token, binding.token, epoch);
  if (!updated || connectionStore.epoch() !== epoch) throw new StaleConnectionError();
  return response.token;
}
