import { AppState, TurboModuleRegistry } from 'react-native';
import type * as AudioApiModule from 'react-native-audio-api';
import { AudioApiEndpoint } from './audio-api-endpoint';
import type { AudioApiSdk } from './audio-api-sdk';
import type { EndpointFactory } from './types';

/** SDK presence is inspected without constructing a device graph. */
function installed(): boolean { return TurboModuleRegistry.get('AudioAPIModule') !== null; }
let sdk: AudioApiSdk | undefined;
function loadSdk(): AudioApiSdk {
  if (!installed()) throw new Error('This build needs React Native Audio API');
  if (!sdk) {
    // JSI installation is deferred until an explicit voice start. Off, profile
    // editing and observer paths do not initialize an audio device graph.
    const module: typeof AudioApiModule = require('react-native-audio-api');
    sdk = { AudioContext: module.AudioContext, AudioRecorder: module.AudioRecorder, AudioManager: module.AudioManager };
  }
  return sdk;
}
export const endpointFactory: EndpointFactory = {
  get transports() { return installed() ? ['relay' as const] : []; },
  create: callbacks => new AudioApiEndpoint(callbacks, {
    sdk: loadSdk,
    foreground: () => AppState.currentState === 'active',
    onForegroundChange: listener => {
      const subscription = AppState.addEventListener('change', state => listener(state === 'active'));
      return () => subscription.remove();
    },
    now: () => performance.now(),
  }),
};
