import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createConnectionStore } from './connection-core';
import type { ServerBinding } from './types';
import { createCredentialPersistence } from './credential-storage';
import { randomHex } from './utils';
import { connectionNamespace } from './connection-contract';
export type { ConnectionState } from './connection-core';

const STORAGE_KEY = 'nomifun.connection.v1';
const nativePersistence = createCredentialPersistence({
  get: () => AsyncStorage.getItem(STORAGE_KEY),
  set: value => AsyncStorage.setItem(STORAGE_KEY, value),
}, {
  get: async key => (await import('expo-secure-store')).getItemAsync(key),
  set: async (key, token) => (await import('expo-secure-store')).setItemAsync(key, token),
  remove: async key => (await import('expo-secure-store')).deleteItemAsync(key),
}, () => `nomifun.device.${randomHex(16)}`);

/** Native credentials live in Keychain/Keystore; H5 keeps its same-origin binding. */
export const connectionStore = createConnectionStore({
  async read() {
    if (Platform.OS !== 'web') return nativePersistence.read();
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as ServerBinding : null;
  },
  async write(binding) {
    if (Platform.OS === 'web') {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(binding)); return;
    }
    await nativePersistence.write(binding);
  },
}, Platform.OS === 'web');

export function connectionStorageKey(key: string): string {
  const binding = connectionStore.binding();
  return `${key}:${encodeURIComponent(binding ? connectionNamespace(binding) : 'unbound')}`;
}
