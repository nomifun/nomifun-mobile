/** Gateway presentation helpers; catalog validation and imports stay on the host. */
export const MODEL_GATEWAY_PLATFORM = 'nomifun-model-gateway';

export function gatewayAddress(value: string): { root: string; domain: string; insecure: boolean } | undefined {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) return;
    const path = url.pathname.replace(/\/+$/, '');
    if (path !== '' && path !== '/v1') return;
    url.pathname = '/';
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
    return { root: url.toString().replace(/\/$/, ''), domain: url.host, insecure: url.protocol === 'http:' && !local };
  } catch { return; }
}

export function gatewayExternalUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^https:\/\//i.test(value)) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return;
    for (const key of url.searchParams.keys()) {
      if (/(^|[_-])(key|token|authorization|secret|password|credential)($|[_-])/i.test(key)) return;
    }
    return url.toString();
  } catch { return; }
}

function exactInteger(value: string): bigint {
  if (typeof value !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(value)) throw new RangeError('Invalid gateway decimal integer');
  const integer = BigInt(value);
  if (integer < -(BigInt(2) ** BigInt(63)) || integer > BigInt(2) ** BigInt(63) - BigInt(1)) throw new RangeError('Gateway amount is outside int64');
  return integer;
}

export function gatewayInteger(value: string | null | undefined, locale: string, unknown: string): string {
  if (value == null) return unknown;
  try { return exactInteger(value).toLocaleString(locale); } catch { return unknown; }
}

/** Convert currency minor units using integer arithmetic, without Number rounding. */
export function gatewayMoney(amount: string, currency: string, locale: string, unknown: string): string {
  try {
    const integer = exactInteger(amount);
    const format = new Intl.NumberFormat(locale, { style: 'currency', currency });
    const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
    const divisor = BigInt(10) ** BigInt(digits);
    const magnitude = integer < BigInt(0) ? -integer : integer;
    const major = magnitude / divisor;
    const minor = magnitude % divisor;
    const negativeZero = integer < BigInt(0) && major === BigInt(0);
    const parts = format.formatToParts(integer < BigInt(0) ? -(major || BigInt(1)) : major);
    const fraction = new Intl.NumberFormat(locale, { useGrouping: false, minimumIntegerDigits: Math.max(1, digits), maximumFractionDigits: 0 });
    const zero = new Intl.NumberFormat(locale, { useGrouping: false }).format(BigInt(0));
    return parts.map(part => part.type === 'integer' && negativeZero ? zero : part.type === 'fraction' ? fraction.format(minor) : part.value).join('');
  } catch { return unknown; }
}

export function gatewayDate(value: string | null | undefined, locale: string, unknown: string): string {
  if (!value) return unknown;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? unknown : date.toLocaleString(locale);
}
