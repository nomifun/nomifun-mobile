/**
 * Connection QR/pairing boundary.
 *
 * Canonical envelope:
 *   nomifun://pair?v=1&url=<encoded http(s)://.../device-pair?token=...>
 *
 * Legacy `nomi://pair` envelopes and Desktop `/qr-login` URLs remain parseable.
 * Redemption always uses the device-pair adapter; parsing an old browser QR
 * does not authorize a fallback to browser credentials.
 */
import type { ConnectionAuthResult } from './types';
import { parseQrPayload } from './utils';

export interface ParsedConnectionPayload {
  source: 'desktop-qr' | 'pairing-url';
  credentialKind: 'device-pair' | 'qr-login';
  baseUrl: string;
  qrToken: string;
}

export interface ConnectionPayloadOptions {
  /** H5 must supply its current origin, including when it is unavailable/empty. */
  currentOrigin?: string;
}

export class InvalidPairingUrlError extends Error {
  constructor() {
    super('Invalid Nomifun pairing URL');
    this.name = 'InvalidPairingUrlError';
  }
}

/** No URL or credential is included in the error message. */
export class PairingOriginMismatchError extends Error {
  constructor() {
    super('Pairing URL does not match the current site');
    this.name = 'PairingOriginMismatchError';
  }
}

function parsePairingTarget(raw: string): Omit<ParsedConnectionPayload, 'source'> | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;

  // New device tickets have a closed URL shape. The existing browser QR
  // parser retains its established trailing-slash/query/path compatibility.
  if (url.pathname.replace(/\/+$/, '') === '/device-pair') {
    if (url.hash || url.searchParams.getAll('token').length !== 1) return null;
    for (const [key] of url.searchParams) {
      if (key !== 'token') return null;
    }
    const token = url.searchParams.get('token');
    if (!token || !/^[0-9a-fA-F]{32,128}$/.test(token)) return null;
    return { baseUrl: url.origin, qrToken: token, credentialKind: 'device-pair' };
  }

  const parsed = parseQrPayload(raw);
  return parsed ? { ...parsed, credentialKind: 'qr-login' } : null;
}

/**
 * Parse the versioned app pairing envelope.
 *
 * We do not accept direct JWTs, Relay enrol tokens, credentials, or arbitrary
 * URLs here. The nested value must still pass the existing Desktop QR parser.
 */
export function parsePairingUrl(raw: string): ParsedConnectionPayload | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  if (
    (url.protocol !== 'nomifun:' && url.protocol !== 'nomi:') ||
    url.hostname !== 'pair' ||
    url.port ||
    (url.pathname && url.pathname !== '/')
  ) {
    return null;
  }
  if (url.username || url.password || url.hash) return null;

  const version = url.searchParams.get('v');
  const nested = url.searchParams.get('url');
  if (version !== '1' || !nested) return null;
  if (url.searchParams.getAll('v').length !== 1 || url.searchParams.getAll('url').length !== 1) {
    return null;
  }

  // Keep the envelope deliberately closed: unknown parameters must not turn
  // into an accidental future credential channel.
  for (const [key] of url.searchParams) {
    if (key !== 'v' && key !== 'url') return null;
  }

  const parsed = parsePairingTarget(nested);
  return parsed ? { ...parsed, source: 'pairing-url' } : null;
}

/** Parse either a new pairing URL or the existing Desktop QR URL. */
export function parseConnectionPayload(raw: string): ParsedConnectionPayload | null {
  const pairing = parsePairingUrl(raw);
  if (pairing) return pairing;

  const desktopQr = parsePairingTarget(raw);
  return desktopQr ? { ...desktopQr, source: 'desktop-qr' } : null;
}

/**
 * Resolve the transport before any redemption. H5 uses relative API requests
 * only after proving that the QR belongs to its current origin. An invalid or
 * unavailable H5 origin fails closed instead of selecting the native path.
 */
export function resolveConnectionPayload(
  raw: string,
  options: ConnectionPayloadOptions = {},
): ParsedConnectionPayload {
  const parsed = parseConnectionPayload(raw);
  if (!parsed) throw new InvalidPairingUrlError();
  if (options.currentOrigin === undefined) return parsed;

  let current: URL;
  try {
    current = new URL(options.currentOrigin);
  } catch {
    throw new PairingOriginMismatchError();
  }
  if (
    (current.protocol !== 'http:' && current.protocol !== 'https:') ||
    current.username || current.password ||
    current.origin !== parsed.baseUrl
  ) {
    throw new PairingOriginMismatchError();
  }
  return { ...parsed, baseUrl: '' };
}

export type PairingTokenExchange = (baseUrl: string, qrToken: string, expectedEpoch: number) => Promise<ConnectionAuthResult>;

/** Structured adapters can use the credential kind without reparsing a URL. */
export type ConnectionPayloadExchange = PairingTokenExchange | {
  redeem(payload: ParsedConnectionPayload, expectedEpoch: number): Promise<ConnectionAuthResult>;
};

/**
 * Redeem through the Desktop device-pair endpoint. The auth adapter owns
 * persistence and must never silently downgrade a device ticket to qr-login.
 */
export async function redeemConnectionPayload(
  raw: string,
  expectedEpoch: number,
  exchange?: ConnectionPayloadExchange,
  options: ConnectionPayloadOptions = {},
): Promise<ConnectionAuthResult> {
  const parsed = resolveConnectionPayload(raw, options);
  // Lazy-load the network adapter so the parsing layer remains usable as a
  // pure, platform-neutral module in tests and QR/import tooling.
  const actualExchange = exchange ?? (await import('./auth')).devicePairLogin;
  return typeof actualExchange === 'function'
    ? actualExchange(parsed.baseUrl, parsed.qrToken, expectedEpoch)
    : actualExchange.redeem(parsed, expectedEpoch);
}
