import { useSyncExternalStore } from 'react';
import { appUpdateController } from './runtime';

export function useAppUpdate() {
  return useSyncExternalStore(
    appUpdateController.subscribe,
    appUpdateController.getSnapshot,
    appUpdateController.getSnapshot,
  );
}
