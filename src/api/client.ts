import { Platform } from 'react-native';
import { connectionStore } from './connection';
import { createTransportClient } from './transport-client';
export type { RequestOptions } from './transport-client';

const transport = createTransportClient({ binding: connectionStore.binding, epoch: connectionStore.epoch,
  markAuthExpired: connectionStore.markAuthExpired, sameOrigin: Platform.OS === 'web',
  verified: () => { const state = connectionStore.getState(); return state.phase === 'connected' && state.verified; } });
export const rawRequest = transport.rawRequest;
export const api = transport.api;
export const apiFetcher = <T>(key: string | readonly [string, ...unknown[]]): Promise<T> =>
  api<T>(typeof key === 'string' ? key : key[0]);
