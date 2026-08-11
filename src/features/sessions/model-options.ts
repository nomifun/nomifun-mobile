/**
 * The side-effecting half of model switching (HTTP + SWR), kept out of
 * `model-switch.ts` so the pure grouping logic stays importable by `bun test`
 * without dragging react-native in.
 */
import { useCallback, useMemo } from 'react';

import { api } from '@/api/client';
import { useProviders, useTaskModels } from '@/features/models/hooks';

import { conversationPath, type Conversation } from './api';
import { buildModelGroups, currentModelRef } from './model-switch';

export function patchConversationModel(
  conversationId: string,
  option: { providerId: string; model: string },
): Promise<unknown> {
  return api<unknown>(conversationPath(conversationId), {
    method: 'PATCH',
    // `UpdateConversationRequest` is deny_unknown_fields and `model` is a
    // `ProviderWithModel` — exactly these two keys, nothing else.
    body: { model: { provider_id: option.providerId, model: option.model } },
  });
}

/** Grouped chat-capable models + the current binding, ready for the picker. */
export function useModelOptions(conversation: Conversation | undefined, enabled: boolean) {
  const task = useTaskModels('chat', enabled);
  // `useProviders` has no enable switch; the key is shared with the models
  // screen so an already-cached list costs nothing here.
  const providers = useProviders();
  const current = currentModelRef(conversation);

  const groups = useMemo(
    () => buildModelGroups(task.candidates, providers.providers, current),
    [task.candidates, providers.providers, current],
  );

  const refresh = useCallback(() => {
    task.refresh();
    providers.refresh();
  }, [task, providers]);

  return {
    groups,
    current,
    isLoading: task.isLoading || providers.isLoading,
    /** Catalog unreadable — must not be presented as "no models available". */
    unresolved: task.unresolved || (!!providers.error && !providers.providers),
    error: task.error ?? providers.error,
    refresh,
  };
}
