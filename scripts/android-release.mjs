import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';

const releaseConfig = JSON.parse(readFileSync(new URL('../src/constants/releases.json', import.meta.url), 'utf8'));
export const REPOSITORY = releaseConfig.repository;
export const PACKAGE = releaseConfig.applicationId;
export const CERTIFICATE_SHA256 = releaseConfig.certificateSha256;
export const SCHEMA = releaseConfig.schema;
export const LATEST_MANIFEST_URL = `${REPOSITORY}/releases/latest/download/release-manifest.json`;
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SUPPORTED_ABIS = new Set(['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64']);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function apkName(version) {
  requireValue(typeof version === 'string' && STABLE_VERSION.test(version), 'Expected a stable X.Y.Z APK version.');
  return `nomifun-mobile-${version}.apk`;
}

export function assetUrl(manifest, name) {
  return `${REPOSITORY}/releases/download/${encodeURIComponent(manifest.tag)}/${encodeURIComponent(name)}`;
}

// Validate the same fixed official feed that the app consumes. Unknown optional
// audit fields from the original v1 manifest remain available to release tools.
export function validateManifest(manifest) {
  requireValue(manifest?.schema === SCHEMA, 'Unsupported mobile release schema.');
  const expectedName = apkName(manifest.version);
  requireValue(manifest.repository === REPOSITORY, 'Release repository is not the official mobile repository.');
  requireValue(manifest.tag === `v${manifest.version}`, 'Release tag must match the APK version.');
  requireValue(manifest.channel === undefined || manifest.channel === releaseConfig.channel, 'Release channel must be stable.');
  requireValue(manifest.distribution === undefined || manifest.distribution === releaseConfig.distribution, 'Release distribution must be official-apk.');
  requireValue(typeof manifest.createdAt === 'string' && Number.isFinite(Date.parse(manifest.createdAt)), 'Release creation time is invalid.');
  requireValue(Array.isArray(manifest.assets), 'Release assets are missing.');
  const names = new Set();
  for (const asset of manifest.assets) {
    requireValue(typeof asset?.name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(asset.name), 'Release asset name is invalid.');
    requireValue(!names.has(asset.name), 'Release asset names must be unique.');
    names.add(asset.name);
    requireValue(positiveInteger(asset.bytes) && SHA256.test(asset.sha256), 'Release asset size or SHA-256 is invalid.');
  }
  const apks = manifest.assets.filter((asset) => asset.name.toLowerCase().endsWith('.apk'));
  requireValue(apks.length === 1 && apks[0].name === expectedName, 'Expected exactly one APK with the canonical versioned name.');
  const android = manifest.android;
  requireValue(android?.package === PACKAGE, 'APK package is not com.nomifun.mobile.');
  requireValue(android.versionName === manifest.version, 'APK versionName differs from release version.');
  requireValue(android.assetName === undefined || android.assetName === expectedName, 'Android assetName differs from the canonical APK.');
  requireValue(positiveInteger(android.versionCode) && android.versionCode <= 2_100_000_000, 'APK versionCode is invalid.');
  requireValue(positiveInteger(android.minimumSdk) && positiveInteger(android.targetSdk) && android.minimumSdk <= android.targetSdk, 'APK SDK requirements are invalid.');
  requireValue(android.debuggable === false, 'Official APK must not be debuggable.');
  requireValue(android.certificateSha256 === CERTIFICATE_SHA256, 'APK certificate does not match the pinned official signing certificate.');
  requireValue(Array.isArray(android.abis) && android.abis.length > 0 && new Set(android.abis).size === android.abis.length && android.abis.every((abi) => SUPPORTED_ABIS.has(abi)), 'APK ABI list is invalid.');
  return apks[0];
}

export function parseBadging(text) {
  const packageLine = text.match(/^package: (.+)$/m)?.[1];
  requireValue(packageLine, 'aapt2 did not report a package.');
  const attribute = (name) => packageLine.match(new RegExp(`(?:^| )${name}='([^']*)'`))?.[1];
  const integer = (textValue, label) => {
    requireValue(typeof textValue === 'string' && /^\d+$/.test(textValue), `aapt2 did not report a valid ${label}.`);
    const number = Number(textValue);
    requireValue(positiveInteger(number), `aapt2 reported an invalid ${label}.`);
    return number;
  };
  return {
    package: attribute('name'),
    versionName: attribute('versionName'),
    versionCode: integer(attribute('versionCode'), 'versionCode'),
    minimumSdk: integer(text.match(/^sdkVersion:'(\d+)'$/m)?.[1] ?? text.match(/^minSdkVersion:'(\d+)'$/m)?.[1], 'minimum SDK'),
    targetSdk: integer(text.match(/^targetSdkVersion:'(\d+)'$/m)?.[1], 'target SDK'),
    debuggable: /^application-debuggable(?:\s|$)/m.test(text),
  };
}

export function parseSignature(text) {
  requireValue(/^Verifies\s*$/m.test(text), 'apksigner did not confirm a valid signature.');
  requireValue(/^Number of signers: 1\s*$/m.test(text), 'Official APK must have exactly one signer.');
  const certificates = [...text.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]{64})\s*$/gm)];
  requireValue(certificates.length === 1, 'apksigner did not report exactly one certificate SHA-256.');
  return certificates[0][1].toLowerCase();
}

export function parseAbis(zipEntries) {
  const abis = new Set();
  for (const entry of zipEntries.split(/\r?\n/)) {
    const match = /^lib\/([^/]+)\/[^/]+\.so$/.exec(entry);
    if (match) abis.add(match[1]);
  }
  requireValue(abis.size > 0 && [...abis].every((abi) => SUPPORTED_ABIS.has(abi)), 'APK has no supported native libraries or contains an unknown ABI.');
  return [...abis].sort();
}

export async function fileDigest(filename) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(filename)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { bytes, sha256: hash.digest('hex') };
}

async function executable(filename) {
  try {
    await access(filename, constants.X_OK);
    return filename;
  } catch {
    return null;
  }
}

async function androidTools(sdk) {
  const roots = [...new Set([
    sdk,
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(homedir(), 'Library/Android/sdk'),
    path.join(homedir(), 'Android/Sdk'),
  ].filter(Boolean))];
  for (const root of roots) {
    const directory = path.join(root, 'build-tools');
    const versions = await readdir(directory).catch(() => []);
    versions.sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
    for (const version of versions) {
      const aapt2 = await executable(path.join(directory, version, 'aapt2'));
      const apksigner = await executable(path.join(directory, version, 'apksigner'));
      if (aapt2 && apksigner) return { aapt2, apksigner };
    }
  }
  throw new Error('Android SDK aapt2 and apksigner are required. Pass --sdk <Android SDK directory> or set ANDROID_HOME.');
}

function command(filename, args, env = process.env) {
  try {
    return execFileSync(filename, args, { encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    // Do not forward tool output: local environment paths or unexpected input
    // must not spill into the public release manifest or terminal logs.
    throw new Error(`${path.basename(filename)} failed. Check the APK, Android SDK and Java installation.`);
  }
}

export async function inspectApk(filename, { sdk } = {}) {
  const before = await stat(filename);
  requireValue(before.isFile(), 'APK path is not a regular file.');
  const tools = await androidTools(sdk);
  let javaEnv = process.env;
  if (!process.env.JAVA_HOME && process.platform === 'darwin') {
    try {
      const javaHome = execFileSync('/usr/libexec/java_home', ['-v', '17'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      javaEnv = { ...process.env, JAVA_HOME: javaHome };
    } catch {
      // apksigner can still use java from PATH.
    }
  }
  const identity = parseBadging(command(tools.aapt2, ['dump', 'badging', filename]));
  const certificateSha256 = parseSignature(command(tools.apksigner, ['verify', '--verbose', '--print-certs', filename], javaEnv));
  const abis = parseAbis(command('unzip', ['-Z1', filename]));
  const digest = await fileDigest(filename);
  const after = await stat(filename);
  requireValue(before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && before.ino === after.ino, 'APK changed during verification. Freeze the build output and retry.');
  return { ...identity, certificateSha256, abis, ...digest };
}

export function manifestFromApk(apk, { sourceCommit, createdAt = new Date().toISOString() } = {}) {
  requireValue(typeof sourceCommit === 'string' && /^[a-f0-9]{40}$/.test(sourceCommit), '--source-commit must be the full commit used for this build.');
  const { bytes, sha256, ...android } = apk;
  const name = apkName(apk.versionName);
  const manifest = {
    schema: SCHEMA,
    version: apk.versionName,
    tag: `v${apk.versionName}`,
    repository: REPOSITORY,
    channel: releaseConfig.channel,
    distribution: releaseConfig.distribution,
    sourceCommit,
    createdAt,
    assets: [{ name, bytes, sha256 }],
    android: { assetName: name, ...android },
  };
  validateManifest(manifest);
  return manifest;
}

export async function assertApkMatchesManifest(filename, manifest, options) {
  const asset = validateManifest(manifest);
  const actual = await inspectApk(filename, options);
  for (const key of ['package', 'versionName', 'versionCode', 'minimumSdk', 'targetSdk', 'debuggable', 'certificateSha256']) {
    requireValue(actual[key] === manifest.android[key], `APK ${key} differs from the release manifest.`);
  }
  requireValue(JSON.stringify(actual.abis) === JSON.stringify([...manifest.android.abis].sort()), 'APK ABIs differ from the release manifest.');
  requireValue(actual.bytes === asset.bytes && actual.sha256 === asset.sha256, 'APK bytes or SHA-256 differ from the release manifest.');
  return actual;
}

export async function remoteDigest(url, { expectedBytes, maxBytes = expectedBytes, timeoutMs = 180_000, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/octet-stream', 'Accept-Encoding': 'identity' } });
    requireValue(response.ok && response.body, `Public release request failed with HTTP ${response.status}.`);
    const declared = response.headers.get('content-length');
    if (expectedBytes !== undefined && declared !== null) {
      requireValue(/^\d+$/.test(declared) && Number(declared) === expectedBytes, 'Public asset Content-Length differs from the release manifest.');
    }
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (maxBytes !== undefined && bytes > maxBytes) {
        controller.abort();
        throw new Error('Public asset exceeds the allowed size.');
      }
      hash.update(chunk);
    }
    requireValue(expectedBytes === undefined || bytes === expectedBytes, 'Public asset byte count differs from the release manifest.');
    return { bytes, sha256: hash.digest('hex') };
  } finally {
    controller.abort();
    clearTimeout(timeout);
  }
}
