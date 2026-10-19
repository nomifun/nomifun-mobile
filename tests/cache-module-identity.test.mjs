import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

describe('Metro cache module identity', () => {
  test('real Android resolution and provider hooks reproduce the old split and verify the configured fix', () => {
    // A separate Node process keeps real ESM/CJS modules and React contexts
    // isolated from Bun's module registry and any other test's mocks.
    const output = execFileSync('node', [
      fileURLToPath(new URL('../scripts/check-cache-module-graph.mjs', import.meta.url)),
      '--compare',
    ], { encoding: 'utf8', timeout: 30_000 });
    const { baseline, fixed } = JSON.parse(output);
    expect(baseline.healthy).toBe(false);
    expect(baseline.identity).toEqual({
      providerHasFetcher: true, consumerHasFetcher: false,
      providerHasCache: true, consumerHasCache: false,
      sameCache: false, sameMutate: false,
    });
    expect(fixed.healthy).toBe(true);
    expect(fixed.samePublicEntries).toBe(true);
    expect(fixed.identity).toEqual({
      providerHasFetcher: true, consumerHasFetcher: true,
      providerHasCache: true, consumerHasCache: true,
      sameCache: true, sameMutate: true,
    });
    expect(fixed.entries).toHaveLength(12);
  }, 30_000);
});
