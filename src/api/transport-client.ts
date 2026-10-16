import { ApiError, AuthExpiredError, StaleConnectionError, type ApiEnvelope, type ServerBinding } from './types';
import { normalizeBaseUrl } from './utils';

export interface RequestOptions {
  method?: string;
  body?: unknown;
  formData?: FormData;
  headers?: Record<string, string>;
  baseUrl?: string;
  token?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  credentials?: RequestCredentials;
  /** Fence a multi-request user action to the connection on which it started. */
  expectedEpoch?: number;
}

export interface TransportDependencies {
  binding(): ServerBinding | null;
  epoch(): number;
  verified?(): boolean;
  markAuthExpired(token: string, expectedEpoch: number): void;
  fetch?: typeof fetch;
  sameOrigin?: boolean;
}

/** Shared real HTTP transport, also executable without React Native in stack acceptance. */
export function createTransportClient(deps: TransportDependencies) {
  async function rawRequest<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
    const binding = deps.binding();
    const epoch = deps.epoch();
    if (opts.expectedEpoch !== undefined && opts.expectedEpoch !== epoch) throw new StaleConnectionError();
    const assertCurrent = () => { if (deps.epoch() !== epoch) throw new StaleConnectionError(); };
    const baseUrl = normalizeBaseUrl(opts.baseUrl ?? binding?.baseUrl ?? '');
    if (binding && opts.baseUrl === undefined && deps.verified && !deps.verified()) {
      throw new ApiError('Verify the Desktop identity before using this connection', 409, 'DESKTOP_IDENTITY_UNAVAILABLE');
    }
    if (deps.sameOrigin && baseUrl !== '') throw new ApiError('Web clients must use the current site', 400, 'PAIRING_ORIGIN_MISMATCH');
    // Explicit-address probes/logins never inherit another Desktop's credential.
    const token = opts.token ?? (opts.baseUrl === undefined ? binding?.token : undefined);
    const hasPayload = opts.body !== undefined || opts.formData !== undefined;
    const method = (opts.method ?? (hasPayload ? 'POST' : 'GET')).toUpperCase();
    const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
    if (opts.formData === undefined && opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? (opts.formData ? 120_000 : 30_000));
    const abort = () => controller.abort();
    if (opts.signal?.aborted) abort();
    else opts.signal?.addEventListener('abort', abort, { once: true });
    try {
      const res = await (deps.fetch ?? fetch)(`${baseUrl}${path}`, {
        method, headers, body: opts.formData ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
        signal: controller.signal, credentials: opts.credentials ?? (deps.sameOrigin ? 'same-origin' : 'omit'),
      });
      assertCurrent();
      const text = await res.text();
      assertCurrent();
      let json: unknown = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* The status still explains invalid proxy responses. */ }
      const body = (json ?? {}) as { code?: string; error?: string; message?: string };
      const message = body.error ?? body.message ?? `HTTP ${res.status}`;
      const rejectedCredential = Boolean(token) &&
        ((res.status === 401 && (body.code === 'UNAUTHORIZED' || body.code === 'DEVICE_REVOKED')) ||
         (res.status === 403 && (body.code === 'DEVICE_REVOKED' || (body.code === 'FORBIDDEN' &&
           !/csrf/i.test(message) && /invalid or expired token|authentication required|user not found/i.test(message)))));
      if (rejectedCredential && token) { deps.markAuthExpired(token, epoch); throw new AuthExpiredError(message); }
      if (!res.ok) throw new ApiError(message, res.status, body.code);
      return json as T;
    } finally {
      clearTimeout(timeout); opts.signal?.removeEventListener('abort', abort);
    }
  }
  async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const envelope = await rawRequest<ApiEnvelope<T> & { error?: string; code?: string }>(path, opts);
    if (envelope && typeof envelope === 'object' && 'success' in envelope) {
      if (!envelope.success) throw new ApiError(envelope.message ?? envelope.error ?? 'Request failed', 200, envelope.code);
      return envelope.data as T;
    }
    return envelope as unknown as T;
  }
  return { rawRequest, api };
}
