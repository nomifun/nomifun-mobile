import releaseIdentity from '@/constants/releases.json';

/** Public release identity. Updating the signing key requires an explicit trust change. */
export const OFFICIAL_REPOSITORY_URL = releaseIdentity.repository;
export const OFFICIAL_MOBILE_RELEASES_URL = `${OFFICIAL_REPOSITORY_URL}/releases/latest`;
export const OFFICIAL_RELEASE_MANIFEST_URL = `${OFFICIAL_MOBILE_RELEASES_URL}/download/release-manifest.json`;
export const OFFICIAL_ANDROID_PACKAGE = releaseIdentity.applicationId;
export const OFFICIAL_ANDROID_CERTIFICATE_SHA256 = releaseIdentity.certificateSha256;

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const sha256 = /^[a-f\d]{64}$/i;
const androidAbis = new Set(['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64']);
const MAX_ANDROID_BUILD_CODE = 2_100_000_000;

export interface AndroidRelease {
  schema: 'nomifun.mobile.release.v1';
  version: string;
  tag: string;
  repository: typeof OFFICIAL_REPOSITORY_URL;
  channel: 'stable';
  distribution: 'official-apk';
  releaseUrl: string;
  apk: { name: string; bytes: number; sha256: string; url: string };
  android: {
    package: typeof OFFICIAL_ANDROID_PACKAGE;
    versionCode: number;
    minimumSdk: number;
    abis: readonly string[];
    certificateSha256: typeof OFFICIAL_ANDROID_CERTIFICATE_SHA256;
  };
}

export interface InstalledAppInfo {
  platform: string;
  applicationId: string | null;
  version: string | null;
  buildVersion: string | null;
  androidApiLevel: number | null;
  supportedAbis: readonly string[] | null;
  distribution: 'official-apk' | 'unknown';
}

export type AppUpdateUnavailableReason =
  | 'platform' | 'distribution' | 'package' | 'installed-build'
  | 'installed-version' | 'android-api' | 'abi';
export type AppUpdateErrorCode = 'network' | 'timeout' | 'http' | 'invalid-manifest';

export class ReleaseFetchError extends Error {
  constructor(readonly code: AppUpdateErrorCode) {
    super(code);
    this.name = 'ReleaseFetchError';
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function invalidManifest(): never {
  throw new ReleaseFetchError('invalid-manifest');
}

/**
 * Decode only the fixed official stable APK contract. Legacy v1 manifests predate
 * the two channel fields; their absence is accepted solely inside this adapter.
 * URLs in a manifest are never trusted: all links are derived from our identity.
 */
export function parseOfficialAndroidRelease(value: unknown): AndroidRelease {
  if (!record(value)
    || value.schema !== releaseIdentity.schema
    || value.repository !== OFFICIAL_REPOSITORY_URL
    || typeof value.version !== 'string' || !stableVersion.test(value.version)
    || value.tag !== `v${value.version}`
    || (value.channel !== undefined && value.channel !== releaseIdentity.channel)
    || (value.distribution !== undefined && value.distribution !== releaseIdentity.distribution)
    || !Array.isArray(value.assets) || !record(value.android)) invalidManifest();

  const android = value.android;
  const assetName = `nomifun-mobile-${value.version}.apk`;
  const apkAssets = value.assets.filter((asset: unknown) => record(asset)
    && typeof asset.name === 'string' && /\.apk$/i.test(asset.name));
  if (apkAssets.length !== 1 || !record(apkAssets[0])) invalidManifest();
  const apk = apkAssets[0];
  if (apk.name !== assetName
    || (android.assetName !== undefined && android.assetName !== assetName)
    || !integer(apk.bytes, 1) || typeof apk.sha256 !== 'string' || !sha256.test(apk.sha256)
    || android.package !== OFFICIAL_ANDROID_PACKAGE
    || android.versionName !== value.version
    || !integer(android.versionCode, 1, MAX_ANDROID_BUILD_CODE)
    || !integer(android.minimumSdk, 1, 1_000)
    || (android.targetSdk !== undefined && !integer(android.targetSdk, android.minimumSdk, 1_000))
    || !Array.isArray(android.abis) || android.abis.length === 0
    || !android.abis.every((abi: unknown) => typeof abi === 'string' && androidAbis.has(abi))
    || new Set(android.abis).size !== android.abis.length
    || typeof android.certificateSha256 !== 'string'
    || android.certificateSha256.toLowerCase() !== OFFICIAL_ANDROID_CERTIFICATE_SHA256
    || android.debuggable !== false) invalidManifest();

  return {
    schema: 'nomifun.mobile.release.v1',
    repository: OFFICIAL_REPOSITORY_URL,
    version: value.version,
    tag: value.tag as string,
    channel: 'stable',
    distribution: 'official-apk',
    releaseUrl: `${OFFICIAL_REPOSITORY_URL}/releases/tag/${value.tag}`,
    apk: {
      name: assetName, bytes: apk.bytes, sha256: apk.sha256.toLowerCase(),
      url: `${OFFICIAL_REPOSITORY_URL}/releases/download/${value.tag}/${assetName}`,
    },
    android: {
      package: OFFICIAL_ANDROID_PACKAGE,
      versionCode: android.versionCode,
      minimumSdk: android.minimumSdk,
      abis: [...android.abis] as string[],
      certificateSha256: OFFICIAL_ANDROID_CERTIFICATE_SHA256,
    },
  };
}

function installedUnavailableReason(installed: InstalledAppInfo): AppUpdateUnavailableReason | undefined {
  if (installed.platform !== 'android') return 'platform';
  if (installed.distribution !== 'official-apk') return 'distribution';
  if (installed.applicationId !== OFFICIAL_ANDROID_PACKAGE) return 'package';
  if (installed.buildVersion === null || !/^[1-9]\d*$/.test(installed.buildVersion)
    || !integer(Number(installed.buildVersion), 1, MAX_ANDROID_BUILD_CODE)) return 'installed-build';
  if (installed.version === null || !stableVersion.test(installed.version)) return 'installed-version';
  if (!integer(installed.androidApiLevel, 1, 1_000)) return 'android-api';
  if (!installed.supportedAbis?.some((abi) => androidAbis.has(abi))) return 'abi';
}

export interface AppUpdateDecision {
  status: 'available' | 'current' | 'ahead' | 'unsupported';
  reason?: AppUpdateUnavailableReason;
  release: AndroidRelease;
}

export function evaluateAndroidRelease(release: AndroidRelease, installed: InstalledAppInfo): AppUpdateDecision {
  const reason = installedUnavailableReason(installed);
  if (reason) return { status: 'unsupported', reason, release };
  if (installed.androidApiLevel! < release.android.minimumSdk) {
    return { status: 'unsupported', reason: 'android-api', release };
  }
  if (!installed.supportedAbis!.some((abi) => release.android.abis.includes(abi))) {
    return { status: 'unsupported', reason: 'abi', release };
  }
  const buildCode = Number(installed.buildVersion);
  if (release.android.versionCode > buildCode) return { status: 'available', release };
  if (release.android.versionCode < buildCode) return { status: 'ahead', release };
  if (installed.version !== release.version) {
    return { status: 'unsupported', reason: 'installed-version', release };
  }
  return { status: 'current', release };
}

export interface AppUpdateSnapshot {
  status: 'idle' | 'checking' | AppUpdateDecision['status'] | 'error';
  installed: InstalledAppInfo;
  release?: AndroidRelease;
  /** Last successful remote check. An error never makes an old result current. */
  checkedAt?: number;
  errorCode?: AppUpdateErrorCode;
  reason?: AppUpdateUnavailableReason;
}

export interface AppUpdateController {
  getSnapshot: () => AppUpdateSnapshot;
  subscribe: (listener: () => void) => () => void;
  check: () => Promise<AppUpdateSnapshot>;
}

/** Connection-independent, in-memory state. One request serves concurrent checks. */
export function createAppUpdateController(options: {
  getInstalledApp: () => InstalledAppInfo;
  fetchRelease: () => Promise<AndroidRelease>;
  now?: () => number;
}): AppUpdateController {
  let snapshot: AppUpdateSnapshot = { status: 'idle', installed: options.getInstalledApp() };
  let inFlight: Promise<AppUpdateSnapshot> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: AppUpdateSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
    return next;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    check: () => {
      if (inFlight) return inFlight;
      const installed = options.getInstalledApp();
      const reason = installedUnavailableReason(installed);
      if (reason) {
        return Promise.resolve(publish({ ...snapshot, status: 'unsupported', installed, reason, errorCode: undefined }));
      }

      // Defer work one microtask so even synchronous re-entry by a subscriber
      // sees inFlight and cannot start another network request.
      inFlight = Promise.resolve().then(async () => {
        publish({ ...snapshot, status: 'checking', installed, reason: undefined, errorCode: undefined });
        try {
          const release = await options.fetchRelease();
          return publish({ installed, ...evaluateAndroidRelease(release, installed), checkedAt: (options.now ?? Date.now)() });
        } catch (error) {
          return publish({
            ...snapshot, status: 'error', installed, reason: undefined,
            errorCode: error instanceof ReleaseFetchError ? error.code : 'network',
          });
        }
      }).finally(() => { inFlight = undefined; });
      return inFlight;
    },
  };
}
