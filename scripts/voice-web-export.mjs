import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { access, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { voiceWebSources } from '../e2e/voice-web-provenance.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { 'out-dir': { type: 'string' } } });
if (!globalThis.Bun || !values['out-dir']) throw new Error('Use bun scripts/voice-web-export.mjs --out-dir build.noindex/<fresh-name>');
const output = resolve(root, values['out-dir']);
if (!output.startsWith(join(root, 'build.noindex') + sep)) throw new Error('Export must stay inside this Mobile build.noindex.');
try {
  await access(output);
  throw new Error('Export directory already exists; preserve it and choose a fresh name.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const before = await voiceWebSources(root);
const child = spawn(process.execPath, ['run', 'export:web', '--', '--output-dir', output, '--max-workers', '2', '--clear'], {
  cwd: root, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' },
});
const exitCode = await new Promise((accept, reject) => {
  child.once('error', reject);
  child.once('exit', accept);
});
if (exitCode !== 0) throw new Error('Expo export failed with exit code ' + exitCode);
const after = await voiceWebSources(root);
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Source changed during export; this artifact cannot be accepted.');
await writeFile(join(output, '.voice-web-source.json'), JSON.stringify({
  schema: 'nomifun.voice-web-export.v1', generated_at: new Date().toISOString(), sources: after,
  scope: 'Exact current RN Web source export. No runtime/cloud/device acceptance implied.',
}, null, 2) + '\n');
console.log('Source-bound RN Web export: ' + output);
