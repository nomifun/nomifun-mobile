/**
 * SWR hooks for 模型管理.
 *
 * There are no WS topics for providers/models in the desktop protocol
 * (docs/research/ws-protocol.md has none), so realtime = refetch on
 * `ws.reconnected` plus pull-to-refresh.
 *
 * Every hook distinguishes "request errored" from "catalog is empty": a
 * transient failure must never be read as "the user has no models", otherwise
 * consumers would purge persisted model references. That footgun is already
 * documented in the desktop research doc (§6).
 */
import { useCallback } from 'react';
import useSWR from 'swr';

import { useWsTopic } from '@/hooks/use-ws';

import {
  CLIENT_SETTINGS_KEY,
  PROVIDERS_KEY,
  pickClientDefaults,
  providerModelsKey,
  resolveKey,
  resolveModelsForTask,
} from './api';
import { isManagedProvider } from './platforms';
import type { ClientDefaults, ModelRef, ModelTask, ProviderModelResponse, ProviderResponse } from './types';

/** Managed free provider ranks LAST (the backend returns it first). */
export function orderProviders(providers: readonly ProviderResponse[]): ProviderResponse[] {
  return providers
    .map((provider, index) => ({ provider, index }))
    .sort((a, b) => {
      const rank = Number(isManagedProvider(a.provider.platform)) - Number(isManagedProvider(b.provider.platform));
      return rank || a.index - b.index;
    })
    .map((entry) => entry.provider);
}

export function useProviders() {
  const { data, error, isLoading, mutate } = useSWR<ProviderResponse[]>(PROVIDERS_KEY);
  const refresh = useCallback(() => {
    void mutate();
  }, [mutate]);
  useWsTopic('ws.reconnected', refresh);

  return {
    providers: data ? orderProviders(data) : undefined,
    error: error as Error | undefined,
    isLoading,
    refresh,
    mutate,
  };
}

export function useProvider(providerId: string) {
  const { providers, error, isLoading, refresh, mutate } = useProviders();
  return {
    provider: providers?.find((p) => p.provider_id === providerId),
    /** True only when the list loaded and the id is genuinely absent. */
    missing: !!providers && !providers.some((p) => p.provider_id === providerId),
    error,
    isLoading,
    refresh,
    mutate,
  };
}

/**
 * The management view reads `provider-models` (not `resolve`) on purpose: it
 * must show DISABLED rows, otherwise its own toggle would hide a model forever.
 */
export function useProviderModels(providerId: string) {
  const key = providerId ? providerModelsKey(providerId) : null;
  const { data, error, isLoading, mutate } = useSWR<ProviderModelResponse[]>(key);
  const refresh = useCallback(() => {
    void mutate();
  }, [mutate]);
  useWsTopic('ws.reconnected', refresh);

  const models = data
    ? [...data].sort((a, b) => a.sort_order - b.sort_order || a.model.localeCompare(b.model))
    : undefined;

  return { models, error: error as Error | undefined, isLoading, refresh, mutate };
}

export function useClientDefaults() {
  const { data, error, isLoading, mutate } = useSWR<Record<string, unknown>>(CLIENT_SETTINGS_KEY);
  const refresh = useCallback(() => {
    void mutate();
  }, [mutate]);
  useWsTopic('ws.reconnected', refresh);

  const defaults: ClientDefaults | undefined = data ? pickClientDefaults(data) : undefined;
  return { defaults, error: error as Error | undefined, isLoading, refresh, mutate };
}

/** Candidates for a task, straight from the resolver (enabled rows only). */
export function useTaskModels(task: ModelTask, enabled = true) {
  const { data, error, isLoading, mutate } = useSWR(
    enabled ? resolveKey(task) : null,
    () => resolveModelsForTask(task),
  );
  const refresh = useCallback(() => {
    void mutate();
  }, [mutate]);
  useWsTopic('ws.reconnected', refresh);

  const candidates: ModelRef[] | undefined = data?.models;
  return {
    candidates,
    /** Catalog could not be read — do NOT treat as "no models". */
    unresolved: !!error && !data,
    error: error as Error | undefined,
    isLoading,
    refresh,
  };
}
