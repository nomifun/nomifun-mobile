/**
 * Connection QR/pairing boundary.
 *
 * The current Desktop QR already contains a one-shot `/qr-login` token. A
 * future Desktop/Relay UI can wrap that exact URL in a `nomi://pair` URL
 * without introducing a second credential or a Relay admin API.
 *
 * Pairing URLs are intentionally only an envelope:
 *
 *   nomi://pair?v=1&url=<percent-encoded http(s)://.../qr-login?token=...>
 *
 * The one-shot token is exchanged immediately for the normal Desktop JWT by
 * `redeemConnectionPayload`; the existing auth layer persists the resulting
 * session binding, which includes the JWT and the metadata needed for later
 * requests, not the original pairing envelope.
 */
import type { AuthUser } from './types';
import { parseQrPayload } from './utils';

export interface ParsedConnectionPayload {
  source: 'desktop-qr' | 'pairing-url';
  baseUrl: string;
  qrToken: string;
}

export class InvalidPairingUrlError extends Error {
  constructor() {
    super('Invalid Nomifun pairing URL');
    this.name = 'InvalidPairingUrlError';
  }
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

  if (url.protocol !== 'nomi:' || url.hostname !== 'pair' || (url.pathname && url.pathname !== '/')) {
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

  const parsed = parseQrPayload(nested);
  return parsed ? { ...parsed, source: 'pairing-url' } : null;
}

/** Parse either a new pairing URL or the existing Desktop QR URL. */
export function parseConnectionPayload(raw: string): ParsedConnectionPayload | null {
  const pairing = parsePairingUrl(raw);
  if (pairing) return pairing;

  const desktopQr = parseQrPayload(raw);
  return desktopQr ? { ...desktopQr, source: 'desktop-qr' } : null;
}

export type QrLoginExchange = (baseUrl: string, qrToken: string) => Promise<AuthUser>;

/**
 * Redeem a pairing/desktop QR payload using the existing Desktop QR-login
 * endpoint. The default exchange delegates persistence to the existing auth
 * layer; it never persists the original pairing envelope or Relay credentials.
 */
export async function redeemConnectionPayload(
  raw: string,
  exchange?: QrLoginExchange,
): Promise<AuthUser> {
  const parsed = parseConnectionPayload(raw);
  if (!parsed) throw new InvalidPairingUrlError();
  // Lazy-load the network adapter so the parsing layer remains usable as a
  // pure, platform-neutral module in tests and QR/import tooling.
  const actualExchange =
    exchange ?? ((await import('./auth')).qrLogin as QrLoginExchange);
  return actualExchange(parsed.baseUrl, parsed.qrToken);
}
