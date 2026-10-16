import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function voiceWebSources(root) {
  const files = ['app.json', 'package.json', 'bun.lock', 'tsconfig.json'];
  async function walk(relative) {
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      const next = relative + '/' + entry.name;
      if (entry.isDirectory()) await walk(next);
      else if (entry.isFile()) files.push(next);
      else throw new Error('Symlink source is not accepted for isolated provenance: ' + next);
    }
  }
  for (const directory of ['src', 'public', 'plugins']) await walk(directory);
  const sources = [];
  for (const file of files.sort()) {
    sources.push([file, createHash('sha256').update(await readFile(join(root, file))).digest('hex')]);
  }
  return sources;
}

export async function requireMatchingWebSources(root, exportDir) {
  const marker = JSON.parse(await readFile(join(exportDir, '.voice-web-source.json'), 'utf8'));
  if (marker.schema !== 'nomifun.voice-web-export.v1' ||
      JSON.stringify(marker.sources) !== JSON.stringify(await voiceWebSources(root))) {
    throw new Error('Web export does not match current source. Run voice:web:export again.');
  }
  return marker;
}
