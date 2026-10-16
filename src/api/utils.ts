/** Random hex string; used for the CSRF double-submit value and client ids. */
export function randomHex(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(buf);
  } else {
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Strip trailing slashes so `${base}/api/...` never doubles up. */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Normalize an address entered by a native client.
 *
 * The desktop LAN panel displays a full URL, while a relay deployment is
 * commonly documented as either `relay.example.com:19090` or a bare host.
 * Keep those forms equivalent at the API boundary instead of making every
 * caller guess which scheme/port was intended.
 *
 * The returned value is an origin plus an optional path prefix. Credentials,
 * query strings, fragments, and unsupported schemes are intentionally
 * rejected: accepting any of those would make the value unsafe to concatenate
 * with API paths below.
 */
export function normalizeServerBaseUrl(
  raw: string,
  defaultPort = '25808',
): string | null {
  const value = raw.trim();
  if (!value) return null;

  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value);
  let candidate = value;
  if (!hasScheme) {
    // URL treats a bare IPv6 literal as a path unless it is bracketed.
    if (candidate.includes(':') && !candidate.startsWith('[')) {
      const colonCount = (candidate.match(/:/g) ?? []).length;
      if (colonCount > 1) candidate = `[${candidate}]`;
    }
    candidate = `http://${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname || url.username || url.password) return null;
  if (url.search || url.hash) return null;

  // A bare host has no port in URL; use the desktop LAN default. A complete
  // URL without a port keeps the scheme default (HTTPS therefore remains on
  // 443). An explicit port always wins, including relay-assigned ports.
  if (!hasScheme && !url.port) {
    url.port = defaultPort;
  }

  // Preserve a deliberate path prefix for reverse proxies, but normalize it
  // so the HTTP client never produces a double slash.
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path || '/';
  return normalizeBaseUrl(url.toString());
}

/**
 * Parse the payload of the desktop's WebUI QR code. The QR encodes exactly
 * one URL: `http://<ip>:<port>/qr-login?token=<hex64>` (no JSON, no scheme).
 * Returns null when the string is not a nomifun QR-login link.
 */
export function parseQrPayload(raw: string): { baseUrl: string; qrToken: string } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const path = url.pathname.replace(/\/+$/, '');
  if (!path.endsWith('/qr-login')) return null;
  if (url.searchParams.getAll('token').length !== 1) return null;
  const token = url.searchParams.get('token');
  if (!token || !/^[0-9a-fA-F]{32,128}$/.test(token)) return null;
  return { baseUrl: url.origin, qrToken: token };
}
