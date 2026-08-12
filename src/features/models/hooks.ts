/**
 * SWR hooks for the provider/model graph.
 *
 * Management reads all rows, including disabled rows. Runtime selectors derive
 * their candidates from the same nested provider response, but filter to
 * enabled providers, enabled models and the exact requested capability.
 */
import { useCallback, useMemo } from 'react';
import useSWR from 'swr';

import { useWsTopic } from '@/hooks/use-ws';

import {
  CLIENT_SETTINGS_KEY,
  PROVIDERS_KEY,
  modelProtocolsKey,
  pickClientDefaults,
  providerConnectionsKey,
  providerModelsKey,
  fetchModelProtocolManifest,
  listProviderConnections,
} from './api';
import { isManagedProvider } from './platforms';
import type {
  ClientDefaults,
  ModelRef,
  ModelProtocolManifestResponse,
  ModelTask,
  ModelTrait,
  ProviderConnectionResponse,
  ProviderModelResponse,
  ProviderResponse,
} from './types';
import { orderSelectorProviders, usableModelRefs } from './selectors';

/**
 * Management lists can use the persisted provider sort order. Runtime
 * selectors, however, must preserve the API order within the supplier group
 * just like desktop `orderModelSelectorProviders`.
 */
export function orderProviders(
  providers: readonly ProviderResponse[],
  mode: 'management' | 'selector' = 'management',
): ProviderResponse[] {
  if (mode === 'selector') return orderSelectorProviders(providers);
  return providers
    .map((provider, index) => ({ provider, index }))
    .sort((a, b) => {
      const rank =
        Number(isManagedProvider(a.provider.platform)) -
        Number(isManagedProvider(b.provider.platform));
      if (rank) return rank;
      return a.provider.sort_order - b.provider.sort_order || a.index - b.index;
    })
    .map((entry) => entry.provider);
}

export function useProviders(mode: 'management' | 'selector' = 'management') {
  const { data, error, isLoading, mutate } = useSWR<ProviderResponse[]>(PROVIDERS_KEY);
  const refresh = useCallback(() => mutate(), [mutate]);
  useWsTopic('ws.reconnected', refresh);

  return {
    providers: data ? orderProviders(data, mode) : undefined,
    error: error as Error | undefined,
    isLoading,
    refresh,
    mutate,
  };
}

export function useProvider(providerId: string) {
  const { providers, error, isLoading, refresh, mutate } = useProviders();
  return {
    provider: providers?.find((provider) => provider.provider_id === providerId),
    missing: !!providers && !providers.some((provider) => provider.provider_id === providerId),
    error,
    isLoading,
    refresh,
    mutate,
  };
}

/** Management endpoint: disabled rows must remain visible in this hook. */
export function useProviderModels(providerId: string) {
  const key = providerId ? providerModelsKey(providerId) : null;
  const { data, error, isLoading, mutate } = useSWR<ProviderModelResponse[]>(key);
  const refresh = useCallback(() => mutate(), [mutate]);
  useWsTopic('ws.reconnected', refresh);

  const models = data
    ? [...data].sort(
        (a, b) => a.sort_order - b.sort_order || a.model.localeCompare(b.model),
      )
    : undefined;

  return { models, error: error as Error | undefined, isLoading, refresh, mutate };
}

export function useClientDefaults() {
  const { data, error, isLoading, mutate } = useSWR<Record<string, unknown>>(CLIENT_SETTINGS_KEY);
  const refresh = useCallback(() => mutate(), [mutate]);
  useWsTopic('ws.reconnected', refresh);

  const defaults: ClientDefaults | undefined = data ? pickClientDefaults(data) : undefined;
  return { defaults, error: error as Error | undefined, isLoading, refresh, mutate };
}

/**
 * Derive exact task candidates locally from the canonical nested response.
 * A failed provider request is explicitly represented by `unresolved`, never
 * as an authoritative empty list.
 */
export function useTaskModels(
  task: ModelTask,
  enabled = true,
  requiredTraits: readonly ModelTrait[] = [],
) {
  const providers = useProviders('selector');
  const candidates = useMemo<ModelRef[] | undefined>(() => {
    if (!providers.providers) return undefined;
    if (!enabled) return [];

    return usableModelRefs(providers.providers, task, requiredTraits);
  }, [enabled, providers.providers, requiredTraits, task]);

  return {
    candidates,
    unresolved: !!providers.error && !providers.providers,
    error: providers.error,
    isLoading: providers.isLoading,
    refresh: providers.refresh,
  };
}

export function useProviderConnections(providerId: string, enabled = true) {
  const key = enabled && providerId ? providerConnectionsKey(providerId) : null;
  const { data, error, isLoading, mutate } = useSWR<ProviderConnectionResponse[]>(
    key,
    key ? () => listProviderConnections(providerId) : null,
    { revalidateOnFocus: false },
  );
  const refresh = useCallback(() => mutate(), [mutate]);
  useWsTopic('ws.reconnected', refresh);
  return {
    connections: data ?? [],
    error: error as Error | undefined,
    isLoading,
    refresh,
    mutate,
  };
}

export function useModelProtocolManifests(
  preset: string | undefined,
  tasks: readonly ModelTask[],
  baseUrl?: string,
) {
  const requestedTasks = useMemo(
    () => [...new Set(tasks)],
    [tasks],
  );
  const key =
    preset && requestedTasks.length > 0
      ? ['model-protocol-manifests', preset, baseUrl ?? '', requestedTasks.join(',')]
      : null;
  const { data, error, isLoading, mutate } = useSWR<
    Record<ModelTask, ModelProtocolManifestResponse>
  >(
    key,
    async () => {
      const settled = await Promise.allSettled(
        requestedTasks.map((task) => fetchModelProtocolManifest(preset!, task, baseUrl)),
      );
      const manifests = {} as Record<ModelTask, ModelProtocolManifestResponse>;
      settled.forEach((result, index) => {
        if (result.status === 'fulfilled') manifests[requestedTasks[index]] = result.value;
      });
      return manifests;
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const loadingTasks =
    isLoading && !data ? requestedTasks : [];
  const errorTasks =
    error || (data && requestedTasks.some((task) => !data[task]))
      ? requestedTasks.filter((task) => !data?.[task])
      : [];
  return {
    manifests: data ?? ({} as Partial<Record<ModelTask, ModelProtocolManifestResponse>>),
    loadingTasks,
    errorTasks,
    error: error as Error | undefined,
    isLoading,
    refresh: () => mutate(),
    mutate,
  };
}
