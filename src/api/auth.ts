/**
 * Auth flows against the desktop server. All of these run BEFORE a binding
 * exists, so they take explicit baseUrl arguments and pass them through to
 * rawRequest overrides.
 *
 * Careful: /login, /api/auth/qr-login and /api/auth/setup are rate-limited to
 * 5 failures per 15 minutes per IP — never auto-retry a 401 here.
 */
import { rawRequest } from './client';
import { connectionStore } from './connection';
import type { AuthLoginResponse, AuthStatusResponse, AuthUser } from './types';
import { ApiError } from './types';
import { randomHex } from './utils';

export interface ProbeResult {
  reachable: boolean;
  needsSetup?: boolean;
  isNomifun?: boolean;
  error?: string;
}

/** Cheap unauthenticated probe to validate an address before logging in. */
export async function probeServer(baseUrl: string, timeoutMs = 6000): Promise<ProbeResult> {
  try {
    const status = await rawRequest<AuthStatusResponse>('/api/auth/status', {
      baseUrl,
      timeoutMs,
    });
    if (typeof status?.needs_setup !== 'boolean') {
      return { reachable: true, isNomifun: false };
    }
    return { reachable: true, isNomifun: true, needsSetup: status.needs_setup };
  } catch (err) {
    return { reachable: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function persistLogin(baseUrl: string, res: AuthLoginResponse): Promise<AuthUser> {
  if (!res.success || !res.token) {
    throw new ApiError(res.message ?? 'Login failed', 401);
  }
  await connectionStore.connect({
    baseUrl,
    token: res.token,
    user: res.user ?? null,
    csrfToken: randomHex(),
  });
  return res.user ?? { user_id: '', username: '' };
}

/** Exchange a scanned QR token (one-shot, 5-minute TTL) for a 30-day JWT. */
export async function qrLogin(baseUrl: string, qrToken: string): Promise<AuthUser> {
  const res = await rawRequest<AuthLoginResponse>('/api/auth/qr-login', {
    baseUrl,
    method: 'POST',
    body: { qr_token: qrToken },
    timeoutMs: 10_000,
  });
  return persistLogin(baseUrl, res);
}

/** Username/password login (manual-address fallback). */
export async function passwordLogin(
  baseUrl: string,
  username: string,
  password: string,
): Promise<AuthUser> {
  const res = await rawRequest<AuthLoginResponse>('/login', {
    baseUrl,
    method: 'POST',
    body: { username, password },
    timeoutMs: 10_000,
  });
  return persistLogin(baseUrl, res);
}

/** First-run claim: only valid while GET /api/auth/status says needs_setup. */
export async function setupAdmin(
  baseUrl: string,
  username: string,
  password: string,
): Promise<AuthUser> {
  const res = await rawRequest<AuthLoginResponse>('/api/auth/setup', {
    baseUrl,
    method: 'POST',
    body: { username, password },
    timeoutMs: 10_000,
  });
  return persistLogin(baseUrl, res);
}

/** Blacklist the JWT server-side, then clear local state. */
export async function logout(): Promise<void> {
  try {
    await rawRequest('/logout', { method: 'POST', timeoutMs: 8000 });
  } catch {
    // Best effort — dropping local credentials matters more than the blacklist.
  }
  await connectionStore.disconnect();
}

/** Re-fetch the current user (also serves as a session validity check). */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const res = await rawRequest<{ success: boolean; user?: AuthUser }>('/api/auth/user');
  return res.user ?? null;
}
