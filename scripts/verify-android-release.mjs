#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { assertApkMatchesManifest, assetUrl, LATEST_MANIFEST_URL, remoteDigest, validateManifest } from './android-release.mjs';

try {
  const { values } = parseArgs({ options: {
    manifest: { type: 'string' },
    phase: { type: 'string', default: 'local' },
    apk: { type: 'string' },
    sdk: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/verify-android-release.mjs --manifest <file> --phase <local|assets|manifest|latest> [--apk <file>] [--sdk <directory>]');
  } else {
    if (!values.manifest) throw new Error('--manifest is required.');
    const local = await readFile(values.manifest);
    if (local.length > 128 * 1024) throw new Error('Release manifest exceeds 128 KiB.');
    const manifest = JSON.parse(local.toString('utf8'));
    const asset = validateManifest(manifest);
    if (values.phase === 'local') {
      if (!values.apk) throw new Error('--apk is required for local verification.');
      await assertApkMatchesManifest(values.apk, manifest, { sdk: values.sdk });
      console.log(`Local APK and release manifest match: ${manifest.version} (${manifest.android.versionCode}).`);
    } else if (values.phase === 'assets') {
      const remote = await remoteDigest(assetUrl(manifest, asset.name), { expectedBytes: asset.bytes });
      if (remote.sha256 !== asset.sha256) throw new Error('Published APK SHA-256 differs from the verified local APK.');
      console.log(`Public APK verified: ${asset.name}, ${remote.bytes} bytes, SHA-256 ${remote.sha256}`);
    } else if (values.phase === 'manifest' || values.phase === 'latest') {
      const url = values.phase === 'latest' ? LATEST_MANIFEST_URL : assetUrl(manifest, 'release-manifest.json');
      const remote = await remoteDigest(url, { expectedBytes: local.length });
      if (remote.sha256 !== createHash('sha256').update(local).digest('hex')) throw new Error('Published release manifest differs from the verified local file.');
      console.log(`${values.phase === 'latest' ? 'Latest feed' : 'Pinned public manifest'} verified: ${manifest.version} (${manifest.android.versionCode}).`);
    } else {
      throw new Error('--phase must be local, assets, manifest or latest.');
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
