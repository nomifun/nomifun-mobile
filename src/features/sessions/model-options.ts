/**
 * The side-effecting half of model switching (HTTP + SWR), kept out of
 * `model-switch.ts` so the pure grouping logic stays importable by `bun test`
 * without dragging react-native in.
 */
import { useMemo } from 'react';

import { useProviders } from '@/features/models/hooks';
import { usableModelRefs } from '@/features/models/selectors';

import type { Conversation } from './api';
import { buildModelGroups, currentModelRef } from './model-switch';

/** Grouped chat-capable models + the current binding, ready for the picker. */
export function useModelOptions(conversation: Conversation | undefined, enabled: boolean) {
  const providers = useProviders('selector');
  const current = currentModelRef(conversation);

  const groups = useMemo(
    () => buildModelGroups(
      enabled && providers.providers ? usableModelRefs(providers.providers, 'chat') : [],
      providers.providers,
      current,
    ),
    [enabled, providers.providers, current],
  );

  return {
    groups,
    current,
    isLoading: providers.isLoading,
    /** Catalog unreadable — must not be presented as "no models available". */
    unresolved: !!providers.error && !providers.providers,
    error: providers.error,
    refresh: providers.refresh,
  };
}
