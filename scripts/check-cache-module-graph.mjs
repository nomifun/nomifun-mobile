import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Exercise Metro's actual file map and resolver, including import/require conditions. */
export async function resolveCacheModules({ baseline = false } = {}) {
  const { getDefaultConfig } = require('expo/metro-config');
  const { loadConfig } = require('metro');
  const DependencyGraph = require('metro/private/node-haste/DependencyGraph').default;
  // The original app had no custom Metro configuration. loadConfig normally
  // adds projectRoot to watchFolders after loading Expo's defaults.
  const config = baseline ? getDefaultConfig(projectRoot) : await loadConfig({ cwd: projectRoot });
  if (baseline) config.watchFolders = [config.projectRoot, ...config.watchFolders];
  config.resolver.useWatchman = false;
  config.maxWorkers = 2;
  config.reporter = { update() {} };
  const graph = new DependencyGraph(config, { watch: false });
  try {
    await graph.ready();
    const entries = [];
    for (const name of ['swr', 'swr/infinite', 'swr/immutable', 'swr/mutation', 'swr/subscription', 'swr/_internal']) {
      for (const isESMImport of [true, false]) {
        const result = graph.resolveDependency(
          join(projectRoot, 'src/app/_layout.tsx'),
          { name, data: { isESMImport, key: name, locs: [], asyncType: null } },
          'android',
          { dev: false },
        );
        if (result.type !== 'sourceFile') throw new Error(`SWR did not resolve to source: ${name}`);
        entries.push({ name, isESMImport, path: result.filePath });
      }
    }
    return entries;
  } finally {
    await graph.end();
  }
}

/** Render real provider/consumer hooks using the files selected by Metro. */
export async function probeCacheIdentity(entries) {
  const React = require('react');
  const { renderToString } = require('react-dom/server');
  const entry = (name, isESMImport) => entries.find(value => value.name === name && value.isESMImport === isESMImport).path;
  const provider = await import(pathToFileURL(entry('swr', true)).href);
  const consumer = require(entry('swr/_internal', false));
  const cache = new Map();
  const fetcher = async () => ({ items: [], total: 0, has_more: false });
  let inherited;
  function Consumer() {
    const outer = provider.useSWRConfig();
    const inner = consumer.useSWRConfig();
    inherited = {
      providerHasFetcher: outer.fetcher === fetcher,
      consumerHasFetcher: inner.fetcher === fetcher,
      providerHasCache: outer.cache === cache,
      consumerHasCache: inner.cache === cache,
      sameCache: outer.cache === inner.cache,
      sameMutate: outer.mutate === inner.mutate,
    };
    return null;
  }
  renderToString(React.createElement(provider.SWRConfig, {
    value: { provider: () => cache, fetcher },
  }, React.createElement(Consumer)));
  return inherited;
}

export async function inspectCacheSourceMap(path) {
  const map = JSON.parse(await readFile(path, 'utf8'));
  const sources = [];
  const collect = current => {
    sources.push(...(current.sources ?? []));
    for (const section of current.sections ?? []) collect(section.map);
  };
  collect(map);
  const swrSources = [...new Set(sources.map(source => source.replaceAll('\\', '/')))]
    .filter(source => /(?:^|\/)node_modules\/swr\/dist\//.test(source));
  const contexts = swrSources.filter(source => /\/config-context-[^/]+\.(?:js|mjs)$/.test(source));
  return { path: resolve(path), swrSources, contexts, singleContext: contexts.length === 1 };
}

export async function checkCacheModuleGraph({ baseline = false, sourceMap } = {}) {
  const entries = await resolveCacheModules({ baseline });
  const identity = await probeCacheIdentity(entries);
  const bundle = sourceMap ? await inspectCacheSourceMap(sourceMap) : undefined;
  const samePublicEntries = entries.every(entry =>
    entry.path === entries.find(other => other.name === entry.name).path);
  return {
    baseline,
    healthy: samePublicEntries && Object.values(identity).every(Boolean) && (!bundle || bundle.singleContext),
    samePublicEntries,
    identity,
    entries,
    ...(bundle ? { bundle } : {}),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const sourceMap = args.includes('--source-map') ? args[args.indexOf('--source-map') + 1] : undefined;
    if (args.includes('--source-map') && !sourceMap) throw new Error('--source-map requires a .map path');
    if (args.includes('--compare')) {
      const baseline = await checkCacheModuleGraph({ baseline: true });
      const fixed = await checkCacheModuleGraph({ sourceMap });
      process.stdout.write(`${JSON.stringify({ baseline, fixed }, null, 2)}\n`);
      if (!fixed.healthy) process.exitCode = 1;
    } else {
      const report = await checkCacheModuleGraph({ baseline: args.includes('--baseline'), sourceMap });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (!report.healthy) process.exitCode = 1;
    }
  } catch (failure) {
    process.stderr.write(`${failure.stack ?? failure}\n`);
    process.exitCode = 1;
  }
}
