import { AppState, Platform } from 'react-native';
import { useEffect, useSyncExternalStore } from 'react';
import { connectionStore } from '@/api/connection';
import { voiceAPI, mediaSocket, operationIdentity } from './api';
import { VoiceController } from './controller';
import { endpointFactory } from './media/endpoint';
import { StaleConnectionError } from '@/api/types';
import { scopeConnectionPort } from '@/api/connection-port';

const foreground = () => Platform.OS === 'web' ? typeof document !== 'undefined' && document.visibilityState === 'visible' : AppState.currentState === 'active';
function controllerForConnection(epoch: number) {
  // Every old media/control/receipt port stays fenced to its original Desktop.
  const api = scopeConnectionPort(voiceAPI, connectionStore.epoch, epoch);
  return new VoiceController({ api, endpoints: endpointFactory, socket: (id, ticket) => {
    if (connectionStore.epoch() !== epoch) throw new StaleConnectionError();
    return mediaSocket(id, ticket);
  }, identity: operationIdentity, now: () => typeof performance !== 'undefined' ? performance.now() : Date.now(), foreground });
}
let ownerEpoch = connectionStore.epoch();
export let voiceController = controllerForConnection(ownerEpoch);
connectionStore.subscribe(() => {
  if (connectionStore.epoch() === ownerEpoch) return;
  const previous = voiceController;
  ownerEpoch = connectionStore.epoch(); voiceController = controllerForConnection(ownerEpoch);
  // Closing the old client releases its local device; stale ports cannot target the new Desktop.
  void previous.end('permission_revoked').catch(() => undefined);
});
export const voiceTransports = endpointFactory.transports;
export const useVoice = () => useSyncExternalStore(voiceController.subscribe, voiceController.getSnapshot, voiceController.getSnapshot);
/** Global UI lifetime is independent of text routes and business WebSocket. */
export function VoiceLifecycle() {
  useEffect(() => {
    const controller = voiceController;
    const changed = AppState.addEventListener('change', state => { if (state !== 'active') controller.background(); });
    const hidden = () => { if (!foreground()) controller.background(); };
    if (Platform.OS === 'web') document.addEventListener('visibilitychange', hidden);
    return () => { changed.remove(); if (Platform.OS === 'web') document.removeEventListener('visibilitychange', hidden); void controller.end('app_shutdown'); };
  }, []);
  return null;
}
