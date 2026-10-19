import { describe, expect, test } from 'bun:test';
import {
  createAppUpdateController, evaluateAndroidRelease, parseOfficialAndroidRelease,
  OFFICIAL_ANDROID_CERTIFICATE_SHA256, OFFICIAL_ANDROID_PACKAGE,
  OFFICIAL_RELEASE_MANIFEST_URL, OFFICIAL_REPOSITORY_URL, ReleaseFetchError,
  type InstalledAppInfo, type AppUpdateErrorCode,
} from './core';
import { fetchOfficialAndroidRelease } from '@/api/releases';

function manifest() {
  return {
    schema: 'nomifun.mobile.release.v1', repository: OFFICIAL_REPOSITORY_URL,
    version: '0.1.2', tag: 'v0.1.2',
    assets: [
      { name: 'nomifun-mobile-0.1.2.apk', bytes: 92_437_911, sha256: 'b'.repeat(64) },
      { name: 'nomifun-mobile-0.1.2-web.zip', bytes: 35, sha256: 'c'.repeat(64) },
    ],
    android: {
      package: OFFICIAL_ANDROID_PACKAGE, versionName: '0.1.2', versionCode: 5,
      minimumSdk: 24, targetSdk: 36, abis: ['arm64-v8a', 'x86_64'],
      certificateSha256: OFFICIAL_ANDROID_CERTIFICATE_SHA256, debuggable: false,
    },
  };
}

function installed(overrides: Partial<InstalledAppInfo> = {}): InstalledAppInfo {
  return {
    platform: 'android', applicationId: OFFICIAL_ANDROID_PACKAGE, version: '0.1.1',
    buildVersion: '4', androidApiLevel: 34, supportedAbis: ['arm64-v8a', 'armeabi-v7a'],
    distribution: 'official-apk', ...overrides,
  };
}

function response(body: unknown, options: { url?: string; status?: number; headers?: HeadersInit } = {}): Response {
  const value = new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: options.status ?? 200, headers: options.headers,
  });
  Object.defineProperty(value, 'url', { value: options.url ?? OFFICIAL_RELEASE_MANIFEST_URL });
  return value;
}

function fetchReturning(value: Response): typeof globalThis.fetch {
  return (() => Promise.resolve(value)) as typeof globalThis.fetch;
}

async function expectFailure(operation: Promise<unknown>, code: AppUpdateErrorCode): Promise<void> {
  let caught: unknown;
  try { await operation; } catch (error) { caught = error; }
  expect(caught instanceof ReleaseFetchError).toBe(true);
  expect(caught).toMatchObject({ code });
}

describe('official APK manifest boundary', () => {
  test('normalizes the published v1 and explicit stable contract to the same release', () => {
    const legacy = parseOfficialAndroidRelease(manifest());
    expect(legacy).toEqual(parseOfficialAndroidRelease({
      ...manifest(), channel: 'stable', distribution: 'official-apk',
      android: { ...manifest().android, assetName: 'nomifun-mobile-0.1.2.apk' },
    }));
    expect(legacy.apk.url).toBe(`${OFFICIAL_REPOSITORY_URL}/releases/download/v0.1.2/nomifun-mobile-0.1.2.apk`);
    expect(legacy.releaseUrl).toBe(`${OFFICIAL_REPOSITORY_URL}/releases/tag/v0.1.2`);
  });

  test('constructs download links and ignores untrusted URL-shaped fields', () => {
    const release = parseOfficialAndroidRelease({
      ...manifest(), downloadUrl: 'https://evil.example/app.apk',
      assets: [{ ...manifest().assets[0], url: 'http://evil.example/app.apk' }],
    });
    expect(release.apk.url.startsWith(`${OFFICIAL_REPOSITORY_URL}/releases/download/`)).toBe(true);
  });

  test('rejects alternate products, prereleases, channels and ambiguous APKs', () => {
    for (const value of [
      null, [], {}, { ...manifest(), schema: 'nomifun.mobile.release.v2' },
      { ...manifest(), repository: 'https://github.com/attacker/nomifun-mobile' },
      { ...manifest(), repository: `${OFFICIAL_REPOSITORY_URL}/` },
      { ...manifest(), version: '0.1.2-beta.1', tag: 'v0.1.2-beta.1' },
      { ...manifest(), version: '00.1.2', tag: 'v00.1.2' },
      { ...manifest(), tag: 'v0.1.3' },
      { ...manifest(), channel: 'preview' }, { ...manifest(), distribution: 'play-store' },
      { ...manifest(), assets: [] },
      { ...manifest(), assets: [...manifest().assets, manifest().assets[0]] },
      { ...manifest(), assets: [{ ...manifest().assets[0], name: 'app.apk' }] },
      { ...manifest(), assets: [{ ...manifest().assets[0], name: '../nomifun-mobile-0.1.2.apk' }] },
      { ...manifest(), android: { ...manifest().android, assetName: 'other.apk' } },
    ]) expect(() => parseOfficialAndroidRelease(value)).toThrow(ReleaseFetchError);
  });

  test('rejects unknown signing identities, debug packages and invalid artifact facts', () => {
    for (const android of [
      { ...manifest().android, package: 'com.nomifun.test' },
      { ...manifest().android, versionName: '0.1.3' },
      { ...manifest().android, versionCode: 0 },
      { ...manifest().android, versionCode: '5' },
      { ...manifest().android, versionCode: 2_100_000_001 },
      { ...manifest().android, minimumSdk: 24.5 },
      { ...manifest().android, targetSdk: 23 },
      { ...manifest().android, abis: [] },
      { ...manifest().android, abis: ['arm64-v8a', 'arm64-v8a'] },
      { ...manifest().android, abis: ['unknown'] },
      { ...manifest().android, certificateSha256: 'e'.repeat(64) },
      { ...manifest().android, certificateSha256: undefined },
      { ...manifest().android, debuggable: true },
      { ...manifest().android, debuggable: undefined },
    ]) expect(() => parseOfficialAndroidRelease({ ...manifest(), android })).toThrow(ReleaseFetchError);
    for (const apk of [
      { ...manifest().assets[0], bytes: 0 },
      { ...manifest().assets[0], bytes: 1.5 },
      { ...manifest().assets[0], bytes: Number.MAX_SAFE_INTEGER + 1 },
      { ...manifest().assets[0], sha256: 'invalid' },
    ]) expect(() => parseOfficialAndroidRelease({ ...manifest(), assets: [apk] })).toThrow(ReleaseFetchError);
  });
});

describe('installed APK eligibility', () => {
  const release = parseOfficialAndroidRelease(manifest());
  test('uses Android build code numerically and distinguishes a newer local installation', () => {
    expect(evaluateAndroidRelease(release, installed()).status).toBe('available');
    expect(evaluateAndroidRelease(release, installed({ version: '0.1.2', buildVersion: '5' })).status).toBe('current');
    expect(evaluateAndroidRelease(release, installed({ version: '0.1.3', buildVersion: '10' })).status).toBe('ahead');
    expect(evaluateAndroidRelease(release, installed({ version: '0.1.2', buildVersion: '4' })).status).toBe('available');
  });

  test('unknown platform, distribution or install identity cannot claim the latest version', () => {
    const cases = [
      [{ platform: 'web' }, 'platform'], [{ platform: 'ios' }, 'platform'],
      [{ distribution: 'unknown' }, 'distribution'], [{ applicationId: null }, 'package'],
      [{ applicationId: 'com.nomifun.legacy' }, 'package'],
      [{ buildVersion: null }, 'installed-build'], [{ buildVersion: '5x' }, 'installed-build'],
      [{ buildVersion: '5.0' }, 'installed-build'], [{ buildVersion: '0' }, 'installed-build'],
      [{ buildVersion: '2100000001' }, 'installed-build'],
      [{ version: null }, 'installed-version'], [{ version: 'dev' }, 'installed-version'],
      [{ version: '0.1.1', buildVersion: '5' }, 'installed-version'],
      [{ androidApiLevel: null }, 'android-api'], [{ androidApiLevel: 23 }, 'android-api'],
      [{ androidApiLevel: 24.5 }, 'android-api'],
      [{ supportedAbis: null }, 'abi'], [{ supportedAbis: [] }, 'abi'],
      [{ supportedAbis: ['armeabi-v7a'] }, 'abi'],
    ] as const;
    for (const [patch, reason] of cases) {
      expect(evaluateAndroidRelease(release, installed(patch))).toMatchObject({ status: 'unsupported', reason });
    }
  });
});

describe('anonymous release transport', () => {
  test('uses only the fixed HTTPS endpoint without credentials or response cache', async () => {
    let input: string | URL | Request | undefined;
    let init: RequestInit | undefined;
    const fetch = ((url: string | URL | Request, options?: RequestInit) => {
      input = url; init = options;
      return Promise.resolve(response(manifest(), { url: 'https://release-assets.githubusercontent.com/github-production-release-asset/123/abc?token=public' }));
    }) as typeof globalThis.fetch;
    expect((await fetchOfficialAndroidRelease({ fetch })).android.versionCode).toBe(5);
    expect(input).toBe(OFFICIAL_RELEASE_MANIFEST_URL);
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'follow', headers: { Accept: 'application/json' } });
    expect(new Headers(init!.headers).has('authorization')).toBe(false);
    expect(new Headers(init!.headers).has('cookie')).toBe(false);
  });

  test('accepts a fixed tagged release response and rejects foreign or insecure redirects', async () => {
    const tagged = `${OFFICIAL_REPOSITORY_URL}/releases/download/v0.1.2/release-manifest.json`;
    expect((await fetchOfficialAndroidRelease({ fetch: fetchReturning(response(manifest(), { url: tagged })) })).version).toBe('0.1.2');
    for (const url of [
      '', 'http://release-assets.githubusercontent.com/file', 'https://evil.example/file',
      'https://release-assets.githubusercontent.com.evil.example/file',
      'https://user@release-assets.githubusercontent.com/file',
      'https://release-assets.githubusercontent.com:8443/file',
      'https://github.com/attacker/nomifun-mobile/releases/download/v0.1.2/release-manifest.json',
      `${OFFICIAL_REPOSITORY_URL}/releases/download/v0.1.2-beta/release-manifest.json`,
    ]) {
      await expectFailure(fetchOfficialAndroidRelease({ fetch: fetchReturning(response(manifest(), { url })) }), 'invalid-manifest');
    }
  });

  test('distinguishes HTTP, malformed manifest, network, and timeout failures', async () => {
    await expectFailure(fetchOfficialAndroidRelease({ fetch: fetchReturning(response('', { status: 404 })) }), 'http');
    for (const badResponse of [
      response('{'), response(manifest(), { headers: { 'content-length': '131073' } }),
      response(' '.repeat(131073)), response({ ...manifest(), tag: 'bad' }),
    ]) await expectFailure(fetchOfficialAndroidRelease({ fetch: fetchReturning(badResponse) }), 'invalid-manifest');
    await expectFailure(fetchOfficialAndroidRelease({ fetch: (() => Promise.reject(new Error('offline'))) as typeof globalThis.fetch }), 'network');
    let signal: AbortSignal | undefined;
    await expectFailure(fetchOfficialAndroidRelease({ timeoutMs: 5, fetch: ((_url: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => {});
    }) as typeof globalThis.fetch }), 'timeout');
    expect(signal?.aborted).toBe(true);
  });

  test('bounds response body reads as well as connection establishment', async () => {
    const stalled = response(manifest());
    Object.defineProperty(stalled, 'text', { value: () => new Promise<string>(() => {}) });
    await expectFailure(fetchOfficialAndroidRelease({ fetch: fetchReturning(stalled), timeoutMs: 5 }), 'timeout');
  });
});

describe('update check state and retries', () => {
  test('shares concurrent requests and starts a fresh request after completion', async () => {
    let calls = 0;
    let settle: ((value: ReturnType<typeof parseOfficialAndroidRelease>) => void) | undefined;
    const controller = createAppUpdateController({ getInstalledApp: installed, fetchRelease: () => {
      calls += 1;
      return new Promise((resolve) => { settle = resolve; });
    }, now: () => 123 });
    const first = controller.check();
    expect(controller.check()).toBe(first);
    await Promise.resolve();
    expect(calls).toBe(1);
    expect(controller.getSnapshot().status).toBe('checking');
    settle!(parseOfficialAndroidRelease(manifest()));
    expect(await first).toMatchObject({ status: 'available', checkedAt: 123 });
    const next = controller.check();
    expect(next).not.toBe(first);
    await Promise.resolve();
    expect(calls).toBe(2);
    settle!(parseOfficialAndroidRelease(manifest()));
    await next;
  });

  test('retains historical release details but clears the current or available claim after a failed recheck', async () => {
    for (const initial of [installed(), installed({ version: '0.1.2', buildVersion: '5' })]) {
      let fail = false;
      const release = parseOfficialAndroidRelease(manifest());
      const controller = createAppUpdateController({ getInstalledApp: () => initial,
        fetchRelease: async () => { if (fail) throw new ReleaseFetchError('http'); return release; }, now: () => 321 });
      const notifications: string[] = [];
      const unsubscribe = controller.subscribe(() => { notifications.push(controller.getSnapshot().status); });
      await controller.check();
      fail = true;
      expect(await controller.check()).toMatchObject({ status: 'error', errorCode: 'http', checkedAt: 321, release });
      fail = false;
      expect((await controller.check()).status).toBe(initial.buildVersion === '5' ? 'current' : 'available');
      unsubscribe();
      expect(notifications).toEqual(['checking', initial.buildVersion === '5' ? 'current' : 'available', 'checking', 'error', 'checking', initial.buildVersion === '5' ? 'current' : 'available']);
    }
  });

  test('unknown installs do not fetch, and a fresh process does not inherit a cached latest result', async () => {
    let calls = 0;
    const options = { getInstalledApp: () => installed({ distribution: 'unknown' }),
      fetchRelease: async () => { calls += 1; return parseOfficialAndroidRelease(manifest()); } };
    expect((await createAppUpdateController(options).check()).status).toBe('unsupported');
    expect(calls).toBe(0);
    expect(createAppUpdateController(options).getSnapshot().status).toBe('idle');
  });

  test('reentrant checks by subscribers join the same request', async () => {
    let calls = 0;
    let reentrant: Promise<unknown> | undefined;
    const controller = createAppUpdateController({ getInstalledApp: installed,
      fetchRelease: async () => { calls += 1; return parseOfficialAndroidRelease(manifest()); } });
    controller.subscribe(() => { if (controller.getSnapshot().status === 'checking') reentrant = controller.check(); });
    const first = controller.check();
    await first;
    expect(reentrant).toBe(first);
    expect(calls).toBe(1);
  });

  test('a timed-out request that ignores abort cannot overwrite a later successful retry', async () => {
    let lateResponse: ((value: Response) => void) | undefined;
    let calls = 0;
    const fetch = (() => {
      calls += 1;
      if (calls === 1) return new Promise<Response>((resolve) => { lateResponse = resolve; });
      return Promise.resolve(response(manifest()));
    }) as typeof globalThis.fetch;
    const controller = createAppUpdateController({ getInstalledApp: installed,
      fetchRelease: () => fetchOfficialAndroidRelease({ fetch, timeoutMs: 5 }) });
    expect(await controller.check()).toMatchObject({ status: 'error', errorCode: 'timeout' });
    expect((await controller.check()).status).toBe('available');
    const success = controller.getSnapshot();
    lateResponse!(response('', { status: 404 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getSnapshot()).toBe(success);
  });
});
