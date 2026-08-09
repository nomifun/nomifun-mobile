/**
 * HTTP client for the nomifun desktop API.
 *
 * Contract (see docs/research/connectivity.md):
 * - Auth: `Authorization: Bearer <jwt>` on every request.
 * - CSRF double-submit on writes: `x-csrf-token` header must equal the
 *   `nomifun-csrf-token` cookie. We mint our own hex64 value; on web we set
 *   document.cookie (the cookie is not HttpOnly), on native we send a Cookie
 *   header directly.
 * - Responses use the `{ success, data?, message? }` envelope on /api/*.
 * - Auth failures are HTTP 403 with body `{ code: 'FORBIDDEN', error }` —
 *   mapped to AuthExpiredError and the connection store is reset.
 */
import { Platform } from 'react-native';

import { connectionStore } from './connection';
import { ApiEnvelope, ApiError, AuthExpiredError } from './types';
import { normalizeBaseUrl } from './utils';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Extra headers (e.g. Idempotency-Key on message send). */
  headers?: Record<string, string>;
  /** Override the binding (used by the login flow before a binding exists). */
  baseUrl?: string;
  token?: string;
  csrfToken?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function syncWebCsrfCookie(csrfToken: string) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (!document.cookie.includes(`nomifun-csrf-token=${csrfToken}`)) {
    document.cookie = `nomifun-csrf-token=${csrfToken}; path=/; max-age=2592000`;
  }
}

/** Low-level fetch with auth + CSRF; returns the parsed JSON body. */
export async function rawRequest<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const binding = connectionStore.binding();
  const baseUrl = normalizeBaseUrl(opts.baseUrl ?? binding?.baseUrl ?? '');
  const token = opts.token ?? binding?.token;
  const csrfToken = opts.csrfToken ?? binding?.csrfToken;
  const method = (opts.method ?? (opts.body !== undefined ? 'POST' : 'GET')).toUpperCase();

  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (csrfToken) {
    if (Platform.OS === 'web') {
      syncWebCsrfCookie(csrfToken);
    } else {
      headers.Cookie = `nomifun-csrf-token=${csrfToken}`;
    }
    if (WRITE_METHODS.has(method)) headers['x-csrf-token'] = csrfToken;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
      // Same-origin cookies on web; native auth is pure Bearer.
      credentials: Platform.OS === 'web' ? 'same-origin' : 'omit',
    });
  } finally {
    clearTimeout(timeout);
  }

  let json: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (res.status === 403) {
    const body = (json ?? {}) as { code?: string; error?: string; message?: string };
    const msg = body.error ?? body.message ?? '';
    // Auth-expiry messages: "Invalid or expired token" / "Authentication
    // required" / "User not found". A CSRF rejection also mentions "token"
    // ("CSRF token validation failed") but must NOT log the user out.
    const isAuthExpired =
      body.code === 'FORBIDDEN' &&
      !/csrf/i.test(msg) &&
      /invalid or expired token|authentication required|user not found/i.test(msg);
    if (isAuthExpired) {
      connectionStore.markAuthExpired();
      throw new AuthExpiredError(msg);
    }
    throw new ApiError(msg || `HTTP 403`, 403, body.code);
  }

  if (!res.ok) {
    const body = (json ?? {}) as { code?: string; error?: string; message?: string };
    throw new ApiError(body.message ?? body.error ?? `HTTP ${res.status}`, res.status, body.code);
  }

  return json as T;
}

/** Request an /api/* endpoint and unwrap the `{success,data,message}` envelope. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const envelope = await rawRequest<ApiEnvelope<T> & { error?: string }>(path, opts);
  if (envelope && typeof envelope === 'object' && 'success' in envelope) {
    if (!envelope.success) {
      throw new ApiError(envelope.message ?? envelope.error ?? 'Request failed', 200);
    }
    return envelope.data as T;
  }
  return envelope as unknown as T;
}

/** SWR-compatible fetcher: useSWR(['/api/...', deps], apiFetcher). */
export const apiFetcher = <T>(key: string | readonly [string, ...unknown[]]): Promise<T> => {
  const path = typeof key === 'string' ? key : key[0];
  return api<T>(path);
};
