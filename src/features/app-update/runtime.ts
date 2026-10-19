import { fetchOfficialAndroidRelease } from '@/api/releases';
import { createAppUpdateController } from './core';
import { getInstalledApp } from './installed';

// Public release state belongs to the installation, independent of desktop connections.
export const appUpdateController = createAppUpdateController({
  getInstalledApp,
  fetchRelease: fetchOfficialAndroidRelease,
});
