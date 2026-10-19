import { Platform } from 'react-native';
import { createDeviceIdentityStore, generateNativeInstallationKey, generateWebInstallationKey } from './device-identity-core';
import { createIndexedDbDeviceIdentityStore } from './device-identity-indexeddb';

/** Platform-owned identity storage stays independent of connection metadata and credentials. */
export const deviceIdentityStore = Platform.OS === 'web'
  ? createIndexedDbDeviceIdentityStore(() => globalThis.indexedDB, () => generateWebInstallationKey(globalThis.crypto))
  : createDeviceIdentityStore({
    async get(key) { return (await import('expo-secure-store')).getItemAsync(key); },
    async set(key, value) { await (await import('expo-secure-store')).setItemAsync(key, value); },
  }, async () => {
    const { uuid } = await import('expo-modules-core');
    return generateNativeInstallationKey(uuid.v4);
  });
