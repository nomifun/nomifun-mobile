interface SessionTokenWindow {
  issuedAtMs: number;
  expiresAtMs: number;
}

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeBase64Url(value: string): string | undefined {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  if (!normalized || normalized.length % 4 === 1) return undefined;

  const bytes: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const char of normalized) {
    if (char === '=') break;
    const index = BASE64_ALPHABET.indexOf(char);
    if (index < 0) return undefined;
    accumulator = (accumulator << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
      accumulator &= bits === 0 ? 0 : (1 << bits) - 1;
    }
  }

  try {
    const encoded = bytes
      .map((byte) => `%${byte.toString(16).padStart(2, '0')}`)
      .join('');
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

function sessionTokenWindow(token: string): SessionTokenWindow | undefined {
  const payload = token.split('.')[1];
  if (!payload) return undefined;
  const decoded = decodeBase64Url(payload);
  if (!decoded) return undefined;

  try {
    const claims = JSON.parse(decoded) as { iat?: unknown; exp?: unknown };
    if (
      typeof claims.iat !== 'number' ||
      !Number.isFinite(claims.iat) ||
      typeof claims.exp !== 'number' ||
      !Number.isFinite(claims.exp) ||
      claims.iat <= 0 ||
      claims.exp <= claims.iat
    ) {
      return undefined;
    }
    return {
      issuedAtMs: claims.iat * 1_000,
      expiresAtMs: claims.exp * 1_000,
    };
  } catch {
    return undefined;
  }
}

/**
 * Bearer sessions do not receive the desktop's sliding cookie renewal. Refresh
 * at the same half-life boundary while the current JWT is still valid.
 */
export function sessionTokenRefreshDelayMs(
  token: string,
  nowMs = Date.now(),
): number | undefined {
  const window = sessionTokenWindow(token);
  if (!window) return undefined;
  const refreshAtMs =
    window.issuedAtMs + (window.expiresAtMs - window.issuedAtMs) / 2;
  return Math.max(0, refreshAtMs - nowMs);
}
