const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

module.exports = function withDesktopNetworking(config, options) {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    !Object.prototype.hasOwnProperty.call(options, 'usesCleartextTraffic') ||
    typeof options.usesCleartextTraffic !== 'boolean'
  ) {
    throw new TypeError(
      'with-desktop-networking requires an explicit boolean usesCleartextTraffic option',
    );
  }

  const usesCleartextTraffic = String(options.usesCleartextTraffic);
  return withAndroidManifest(config, (modConfig) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      modConfig.modResults,
    );
    application.$['android:usesCleartextTraffic'] = usesCleartextTraffic;
    return modConfig;
  });
};
