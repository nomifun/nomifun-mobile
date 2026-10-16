import { useSyncExternalStore } from 'react';

import { connectionStore, type ConnectionState } from '@/api/connection';

export function useConnection(): ConnectionState {
  return useSyncExternalStore(
    connectionStore.subscribe,
    connectionStore.getState,
    connectionStore.getState,
  );
}
