const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// SWR owns React contexts and cache registries. Its import/require exports must
// resolve to one module family: Metro otherwise mixes the ESM provider with the
// CJS infinite hook, which silently loses the provider's fetcher and cache.
// Keep package exports enabled and let Metro resolve the package's public CJS
// exports rather than depending on SWR's private dist filenames.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const swr = moduleName === 'swr' || moduleName.startsWith('swr/');
  return context.resolveRequest(
    swr ? { ...context, isESMImport: false } : context,
    moduleName,
    platform,
  );
};

module.exports = config;
