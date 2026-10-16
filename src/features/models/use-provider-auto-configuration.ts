import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';

import {
  probeConnectionAnonymous,
  probeProviderConnection,
} from './api';
import {
  applyProviderAutoConfiguration,
  buildProviderAutoConfigurationTargets,
  isAutoConfigurationPlatform,
  selectProviderAutoConfiguration,
  type ProviderAutoConfigurationDetection,
  type ProviderAutoConfigurationProbeAttempt,
} from './auto-configuration';
import type {
  ModelTask,
  ProviderCredentials,
} from './types';
import type {
  ModelDefinitionDraft,
  ModelProtocolManifestMap,
} from './advanced';

export interface ProviderAutoConfigurationBatch {
  requestBaseUrl: string;
  detections: ProviderAutoConfigurationDetection[];
}

export interface UseProviderAutoConfigurationOptions {
  enabled?: boolean;
  platform: string;
  baseUrl: string;
  authScheme: string;
  definition: ModelDefinitionDraft;
  manifests: ModelProtocolManifestMap;
  loadingTasks?: readonly ModelTask[];
  providerId?: string;
  credentials?: ProviderCredentials;
}

interface AutoConfigurationRequest {
  id: string;
  platform: string;
  baseUrl: string;
  model: string;
  targets: ReturnType<typeof buildProviderAutoConfigurationTargets>;
  providerId?: string;
  credentials?: ProviderCredentials;
}

const PROBE_DEBOUNCE_MS = 500;
const EMPTY_TASKS: readonly ModelTask[] = [];

/**
 * Detect protocol/auth/root for Custom and New API task drafts. Credential
 * material stays out of the SWR key and is only held by the local request.
 */
export function useProviderAutoConfiguration({
  enabled = true,
  platform,
  baseUrl,
  authScheme,
  definition,
  manifests,
  loadingTasks = EMPTY_TASKS,
  providerId,
  credentials,
}: UseProviderAutoConfigurationOptions) {
  const credentialState = useRef({ snapshot: '', revision: 0 });
  const credentialSnapshot =
    credentials === undefined ? 'missing' : JSON.stringify(credentials);
  if (credentialState.current.snapshot !== credentialSnapshot) {
    credentialState.current = {
      snapshot: credentialSnapshot,
      revision: credentialState.current.revision + 1,
    };
  }

  const useStoredAuth = providerId !== undefined;
  const targets = useMemo(
    () =>
      buildProviderAutoConfigurationTargets(
        definition,
        manifests,
        authScheme,
        useStoredAuth,
      ).filter((target) => !loadingTasks.includes(target.task)),
    [
      authScheme,
      definition,
      loadingTasks,
      manifests,
      useStoredAuth,
    ],
  );
  const targetKey = JSON.stringify(
    targets.map((target) => [
      target.task,
      target.candidates.map((candidate) => [
        candidate.descriptor.protocol_id,
        candidate.authScheme,
      ]),
    ]),
  );
  const canProbe =
    enabled &&
    isAutoConfigurationPlatform(platform) &&
    Boolean(baseUrl.trim()) &&
    Boolean(definition.model.trim()) &&
    targets.length > 0 &&
    (providerId !== undefined || credentials !== undefined);

  const liveRequest = useMemo<AutoConfigurationRequest | undefined>(() => {
    if (!canProbe) return undefined;
    const normalizedBaseUrl = baseUrl.trim();
    const normalizedModel = definition.model.trim();
    const id = JSON.stringify([
      providerId ?? 'anonymous',
      platform,
      normalizedBaseUrl,
      authScheme.trim(),
      normalizedModel,
      credentialState.current.revision,
      targetKey,
    ]);
    return {
      id,
      platform,
      baseUrl: normalizedBaseUrl,
      model: normalizedModel,
      targets,
      ...(providerId === undefined ? {} : { providerId }),
      ...(credentials === undefined ? {} : { credentials }),
    };
  }, [
    authScheme,
    baseUrl,
    canProbe,
    credentials,
    definition.model,
    platform,
    providerId,
    targetKey,
    targets,
  ]);

  const [debouncedRequest, setDebouncedRequest] =
    useState<AutoConfigurationRequest>();
  const liveRequestRef = useRef(liveRequest);
  liveRequestRef.current = liveRequest;

  useEffect(() => {
    if (!liveRequest) {
      setDebouncedRequest(undefined);
      return;
    }
    const requestId = liveRequest.id;
    const timeout = setTimeout(() => {
      const current = liveRequestRef.current;
      if (current?.id === requestId) setDebouncedRequest(current);
    }, PROBE_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [liveRequest?.id]);

  const request =
    liveRequest && debouncedRequest?.id === liveRequest.id
      ? debouncedRequest
      : undefined;
  const swrKey = request
    ? ['provider-auto-configuration', request.id]
    : null;

  const state = useSWR<ProviderAutoConfigurationBatch>(
    swrKey,
    async () => {
      if (!request) return { requestBaseUrl: '', detections: [] };
      const detections = await Promise.all(
        request.targets.map(async (target) => {
          const attempts = await Promise.all(
            target.candidates.map(
              async (
                candidate,
              ): Promise<ProviderAutoConfigurationProbeAttempt> => {
                try {
                  const response =
                    request.providerId !== undefined
                      ? await probeProviderConnection(request.providerId, {
                          protocol: candidate.descriptor.protocol_id,
                          task: target.task,
                          ...(request.model ? { model: request.model } : {}),
                          probe_candidates: true,
                        })
                      : await probeConnectionAnonymous({
                          platform: request.platform,
                          base_url: request.baseUrl,
                          auth_scheme: candidate.authScheme,
                          credentials: request.credentials ?? {},
                          protocol: candidate.descriptor.protocol_id,
                          task: target.task,
                          ...(request.model ? { model: request.model } : {}),
                          probe_candidates: true,
                        });
                  return { candidate, response };
                } catch {
                  return { candidate };
                }
              },
            ),
          );
          return selectProviderAutoConfiguration(target, attempts);
        }),
      );
      return {
        requestBaseUrl: request.baseUrl,
        detections: detections.filter(
          (detection): detection is ProviderAutoConfigurationDetection =>
            detection !== undefined,
        ),
      };
    },
    {
      keepPreviousData: false,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );

  return {
    ...state,
    isLoading: state.isLoading || (canProbe && request === undefined),
    apply: (current: ModelDefinitionDraft) =>
      applyProviderAutoConfiguration(current, state.data?.detections ?? []),
  };
}
