#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { inspectApk, manifestFromApk } from './android-release.mjs';

try {
  const { values } = parseArgs({ options: {
    apk: { type: 'string' },
    out: { type: 'string' },
    'source-commit': { type: 'string' },
    sdk: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/android-release-manifest.mjs --apk <versioned.apk> --out <release-manifest.json> --source-commit <40-character commit> [--sdk <directory>]');
  } else {
    if (!values.apk || !values.out || !values['source-commit']) throw new Error('--apk, --out and --source-commit are required.');
    const actual = await inspectApk(path.resolve(values.apk), { sdk: values.sdk });
    const manifest = manifestFromApk(actual, { sourceCommit: values['source-commit'] });
    if (path.basename(values.apk) !== manifest.android.assetName) throw new Error(`Rename the APK to ${manifest.android.assetName} before generating its release manifest.`);
    // Existing published metadata is immutable. An intentional regeneration
    // needs a new output path; never overwrite a historical release silently.
    await writeFile(values.out, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    console.log(`Verified ${manifest.android.assetName}: versionCode ${actual.versionCode}, ${actual.bytes} bytes, SHA-256 ${actual.sha256}`);
    console.log(`Created ${path.resolve(values.out)}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
