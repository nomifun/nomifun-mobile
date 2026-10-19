import type { ConfigContext, ExpoConfig } from 'expo/config';
import { version } from './package.json';

/** Product version has one source; native build numbers remain owned by EAS. */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name!,
  slug: config.slug!,
  version,
  // Full binary releases only. Do not accidentally enable an OTA runtime.
  updates: { enabled: false },
  extra: {
    ...config.extra,
    // Set explicitly by the APK build profile; development/store builds must
    // never offer an APK as an update for their installed distribution.
    appDistribution: process.env.NOMIFUN_APP_DISTRIBUTION ?? 'unknown',
  },
});
