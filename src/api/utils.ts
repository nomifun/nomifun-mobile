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
  if (!url.pathname.replace(/\/+$/, '').endsWith('/qr-login')) return null;
  const token = url.searchParams.get('token');
  if (!token || !/^[0-9a-fA-F]{32,128}$/.test(token)) return null;
  return { baseUrl: url.origin, qrToken: token };
}
