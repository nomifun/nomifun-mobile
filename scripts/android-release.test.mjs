import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  apkName, assetUrl, CERTIFICATE_SHA256, fileDigest, manifestFromApk,
  PACKAGE, parseAbis, parseBadging, parseSignature, remoteDigest,
  REPOSITORY, SCHEMA, validateManifest,
} from './android-release.mjs';

function apk(overrides = {}) {
  return {
    package: PACKAGE, versionName: '0.1.3', versionCode: 6,
    minimumSdk: 24, targetSdk: 36, abis: ['arm64-v8a', 'x86_64'],
    debuggable: false, certificateSha256: CERTIFICATE_SHA256,
    bytes: 12345, sha256: 'a'.repeat(64), ...overrides,
  };
}

function manifest() {
  return manifestFromApk(apk(), { sourceCommit: 'b'.repeat(40), createdAt: '2026-10-19T00:00:00.000Z' });
}

test('release identity comes from one shared app/publisher configuration', async () => {
  const config = JSON.parse(await readFile(new URL('../src/constants/releases.json', import.meta.url), 'utf8'));
  assert.equal(REPOSITORY, config.repository);
  assert.equal(PACKAGE, config.applicationId);
  assert.equal(CERTIFICATE_SHA256, config.certificateSha256);
  assert.equal(SCHEMA, config.schema);
  assert.equal(manifest().channel, config.channel);
  assert.equal(manifest().distribution, config.distribution);
});

test('aapt2 output provides actual installed identity and SDK requirements', () => {
  assert.deepEqual(parseBadging("package: name='com.nomifun.mobile' versionCode='6' versionName='0.1.3' platformBuildVersionCode='36'\nsdkVersion:'24'\ntargetSdkVersion:'36'\n"), {
    package: PACKAGE, versionCode: 6, versionName: '0.1.3', minimumSdk: 24, targetSdk: 36, debuggable: false,
  });
  assert.equal(parseBadging("package: name='com.nomifun.mobile' versionCode='6' versionName='0.1.3'\nminSdkVersion:'24'\ntargetSdkVersion:'36'\napplication-debuggable\n").debuggable, true);
  assert.throws(() => parseBadging("package: name='wrong' versionCode='six'\n"), /versionCode/);
  assert.throws(() => parseBadging("package: name='wrong' versionCode='6'\n"), /minimum SDK/);
});

test('signature parser requires verified APK with one signer', () => {
  assert.equal(parseSignature(`Verifies\nNumber of signers: 1\nSigner #1 certificate SHA-256 digest: ${CERTIFICATE_SHA256}\n`), CERTIFICATE_SHA256);
  assert.throws(() => parseSignature(`DOES NOT VERIFY\nNumber of signers: 1\nSigner #1 certificate SHA-256 digest: ${CERTIFICATE_SHA256}\n`), /valid signature/);
  assert.throws(() => parseSignature(`Verifies\nNumber of signers: 2\nSigner #1 certificate SHA-256 digest: ${CERTIFICATE_SHA256}\n`), /one signer/);
});

test('ABI inventory is derived from native library paths', () => {
  assert.deepEqual(parseAbis('AndroidManifest.xml\nlib/x86_64/libexample.so\nlib/arm64-v8a/libexample.so\nlib/x86_64/libother.so\nassets/lib/arm64-v8a/ignored.so\n'), ['arm64-v8a', 'x86_64']);
  assert.throws(() => parseAbis('lib/unknown/libexample.so\n'), /unknown ABI/);
  assert.throws(() => parseAbis('assets/index.android.bundle\n'), /native libraries/);
});

test('manifest accepts legacy official v1 but generates explicit distribution and canonical asset binding', () => {
  const current = manifest();
  assert.equal(current.android.assetName, 'nomifun-mobile-0.1.3.apk');
  assert.equal(validateManifest(current), current.assets[0]);
  assert.equal(assetUrl(current, current.assets[0].name), `${REPOSITORY}/releases/download/v0.1.3/nomifun-mobile-0.1.3.apk`);
  delete current.distribution;
  delete current.channel;
  delete current.android.assetName;
  assert.equal(validateManifest(current), current.assets[0]);
});

test('publisher rejects wrong signing identity, debug builds and inconsistent metadata', () => {
  for (const override of [{ certificateSha256: 'f'.repeat(64) }, { package: 'com.example.app' }, { debuggable: true }, { versionName: '0.1.3-beta.1' }, { versionCode: 0 }, { versionCode: 2_100_000_001 }, { abis: [] }]) {
    assert.throws(() => manifestFromApk(apk(override), { sourceCommit: 'b'.repeat(40) }));
  }
  for (const edit of [
    (value) => { value.tag = 'v0.1.4'; },
    (value) => { value.repository = 'https://example.com/releases'; },
    (value) => { value.channel = 'beta'; },
    (value) => { value.distribution = 'store'; },
    (value) => { value.android.assetName = 'wrong.apk'; },
    (value) => { value.assets[0].sha256 = 'bad'; },
    (value) => { value.assets[0].bytes = 0; },
    (value) => { value.assets.push({ ...value.assets[0], name: 'second.apk' }); },
    (value) => { value.assets.push({ ...value.assets[0] }); },
  ]) {
    const current = manifest();
    edit(current);
    assert.throws(() => validateManifest(current));
  }
  assert.throws(() => apkName('01.2.3'));
  assert.throws(() => manifestFromApk(apk(), { sourceCommit: 'HEAD' }), /source-commit/);
});

test('local digest hashes actual APK bytes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nomifun-release-test-'));
  try {
    const file = path.join(directory, 'example.apk');
    await writeFile(file, 'actual bytes');
    assert.deepEqual(await fileDigest(file), { bytes: 12, sha256: createHash('sha256').update('actual bytes').digest('hex') });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('public verification streams exact bytes and does not send credentials', async () => {
  const expected = Buffer.from('verified artifact');
  const digest = await remoteDigest('https://example.test/file.apk', {
    expectedBytes: expected.length,
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.cache, 'no-store');
      return new Response(expected);
    },
  });
  assert.equal(digest.sha256, createHash('sha256').update(expected).digest('hex'));
  await assert.rejects(remoteDigest('https://example.test/file.apk', { expectedBytes: 1, fetchImpl: async () => new Response(expected) }), /allowed size/);
  await assert.rejects(remoteDigest('https://example.test/file.apk', { expectedBytes: 100, fetchImpl: async () => new Response(expected) }), /byte count/);
  await assert.rejects(remoteDigest('https://example.test/file.apk', { expectedBytes: 100, fetchImpl: async () => new Response(expected, { headers: { 'content-length': '17' } }) }), /Content-Length/);
  await assert.rejects(remoteDigest('https://example.test/file.apk', { fetchImpl: async () => new Response(null, { status: 404 }) }), /HTTP 404/);
});
