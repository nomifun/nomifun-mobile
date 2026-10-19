import {
  OFFICIAL_RELEASE_MANIFEST_URL, OFFICIAL_REPOSITORY_URL,
  parseOfficialAndroidRelease, ReleaseFetchError,
  type AndroidRelease,
} from '@/features/app-update/core';

export {
  OFFICIAL_MOBILE_RELEASES_URL, OFFICIAL_RELEASE_MANIFEST_URL,
  OFFICIAL_REPOSITORY_URL, ReleaseFetchError,
} from '@/features/app-update/core';

const MAX_MANIFEST_BYTES = 128 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

/** GitHub follows its release download redirect to its public asset host. */
function isOfficialManifestResponseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    if (url.hostname === 'release-assets.githubusercontent.com') return true;
    return url.origin === 'https://github.com' && (
      `${url.origin}${url.pathname}` === OFFICIAL_RELEASE_MANIFEST_URL
      || new RegExp(`^${OFFICIAL_REPOSITORY_URL.replaceAll('.', '\\.')}\\/releases\\/download\\/v(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\/release-manifest\\.json$`).test(`${url.origin}${url.pathname}`)
    );
  } catch { return false; }
}

/**
 * Anonymous transport deliberately bypasses Desktop auth, connection epochs and
 * its request cache. A fresh check is required before opening the APK download.
 */
export async function fetchOfficialAndroidRelease(options: {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
} = {}): Promise<AndroidRelease> {
  const abort = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      abort.abort();
      reject(new ReleaseFetchError('timeout'));
    }, timeoutMs);
  });

  const request = async () => {
    const response = await (options.fetch ?? globalThis.fetch)(OFFICIAL_RELEASE_MANIFEST_URL, {
      method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'follow',
      headers: { Accept: 'application/json' }, signal: abort.signal,
    });
    if (!response.ok) throw new ReleaseFetchError('http');
    if (!isOfficialManifestResponseUrl(response.url)) throw new ReleaseFetchError('invalid-manifest');
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_MANIFEST_BYTES)) {
      throw new ReleaseFetchError('invalid-manifest');
    }
    const body = await response.text();
    if (body.length > MAX_MANIFEST_BYTES) throw new ReleaseFetchError('invalid-manifest');
    let value: unknown;
    try { value = JSON.parse(body); } catch { throw new ReleaseFetchError('invalid-manifest'); }
    return parseOfficialAndroidRelease(value);
  };

  try {
    return await Promise.race([request(), timedOut]);
  } catch (error) {
    if (error instanceof ReleaseFetchError) throw error;
    throw new ReleaseFetchError(abort.signal.aborted ? 'timeout' : 'network');
  } finally {
    clearTimeout(timeout);
  }
}
