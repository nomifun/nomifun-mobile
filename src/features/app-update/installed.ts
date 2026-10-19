import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Application from 'expo-application';
import * as Device from 'expo-device';

import type { InstalledAppInfo } from './core';

/** Read the installed binary, never the next release's app-config version. */
export function getInstalledApp(): InstalledAppInfo {
  const web = Platform.OS === 'web';
  const officialApk = Platform.OS === 'android' && !__DEV__ &&
    Constants.executionEnvironment !== ExecutionEnvironment.StoreClient &&
    Constants.expoConfig?.extra?.appDistribution === 'official-apk';
  return {
    platform: Platform.OS,
    applicationId: web ? null : Application.applicationId,
    version: web ? Constants.expoConfig?.version ?? null : Application.nativeApplicationVersion,
    buildVersion: web ? null : Application.nativeBuildVersion,
    androidApiLevel: Platform.OS === 'android' ? Device.platformApiLevel : null,
    supportedAbis: Platform.OS === 'android' ? Device.supportedCpuArchitectures : null,
    distribution: officialApk ? 'official-apk' : 'unknown',
  };
}
