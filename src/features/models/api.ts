/**
 * Typed endpoint functions for 模型管理.
 *
 * Contract notes that bit the desktop already (docs/research/feature-models.md
 * §9) and must not be regressed here:
 * - Request DTOs are `deny_unknown_fields`: build bodies from explicit fields,
 *   never spread a UI record.
 * - Per-model edits go through `POST /api/provider-models/update` (partial by
 *   natural key), never a whole-map `PUT /api/providers/{id}` — that is a
 *   read-modify-write race.
 * - `model_health` sent on provider create/update is ignored; the server probe
 *   is the only health writer, so after a heartbeat we refetch instead of
 *   merging locally.
 * - Clearing a client-preference model reference means writing `null` (deleting
 *   the key), never a half-empty object (the server 409s on dead references and
 *   does not partially persist a batch).
 */
import { api } from '@/api/client';

import { buildTasksUpdateBody } from './tasks';
import type {
  ClientDefaults,
  CreateProviderBody,
  DetectProtocolBody,
  FetchModelsResponse,
  ModelRef,
  ModelTask,
  ModelTrait,
  ProtocolDetectionResponse,
  ProviderHealthCheckResponse,
  ProviderModelResponse,
  ProviderResponse,
  ResolveModelsResponse,
  SpeechToTextConfig,
  TextToSpeechConfig,
  UpdateProviderBody,
} from './types';

export const PROVIDERS_KEY = '/api/providers';
export const CLIENT_SETTINGS_KEY = '/api/settings/client';

export const providerModelsKey = (providerId: string): string =>
  `/api/provider-models?provider_id=${encodeURIComponent(providerId)}`;

export const resolveKey = (task: ModelTask): readonly [string, ModelTask] =>
  ['/api/model-profiles/resolve', task] as const;

/* ------------------------------------------------------------------ providers */

export function listProviders(): Promise<ProviderResponse[]> {
  return api<ProviderResponse[]>(PROVIDERS_KEY);
}

export function createProvider(body: CreateProviderBody): Promise<ProviderResponse> {
  const payload: Record<string, unknown> = {
    platform: body.platform,
    name: body.name,
    base_url: body.base_url,
    api_key: body.api_key,
  };
  if (body.models && body.models.length > 0) payload.models = body.models;
  if (body.enabled !== undefined) payload.enabled = body.enabled;
  return api<ProviderResponse>(PROVIDERS_KEY, { body: payload });
}

export function updateProvider(
  providerId: string,
  patch: UpdateProviderBody,
): Promise<ProviderResponse> {
  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.base_url !== undefined) payload.base_url = patch.base_url;
  if (patch.api_key !== undefined) payload.api_key = patch.api_key;
  if (patch.enabled !== undefined) payload.enabled = patch.enabled;
  return api<ProviderResponse>(`${PROVIDERS_KEY}/${encodeURIComponent(providerId)}`, {
    method: 'PUT',
    body: payload,
  });
}

export function deleteProvider(providerId: string): Promise<void> {
  return api<void>(`${PROVIDERS_KEY}/${encodeURIComponent(providerId)}`, { method: 'DELETE' });
}

/** Upstream catalog for a SAVED provider. */
export function fetchProviderModels(
  providerId: string,
  tryFix = false,
): Promise<FetchModelsResponse> {
  return api<FetchModelsResponse>(`${PROVIDERS_KEY}/${encodeURIComponent(providerId)}/models`, {
    body: { try_fix: tryFix },
    timeoutMs: 20_000,
  });
}

/** Upstream catalog before the provider row exists (add-provider form). */
export function fetchModelsAnonymous(input: {
  platform: string;
  base_url: string;
  api_key: string;
  try_fix?: boolean;
}): Promise<FetchModelsResponse> {
  return api<FetchModelsResponse>(`${PROVIDERS_KEY}/fetch-models`, {
    body: {
      platform: input.platform,
      base_url: input.base_url,
      api_key: input.api_key,
      try_fix: input.try_fix ?? false,
    },
    timeoutMs: 20_000,
  });
}

/** Connectivity test #1: does this (base_url, api_key) pair authenticate? */
export function detectProtocol(body: DetectProtocolBody): Promise<ProtocolDetectionResponse> {
  return api<ProtocolDetectionResponse>(`${PROVIDERS_KEY}/detect-protocol`, {
    body: {
      base_url: body.base_url,
      api_key: body.api_key,
      timeout: body.timeout ?? 10_000,
      test_all_keys: body.test_all_keys ?? false,
    },
    timeoutMs: 25_000,
  });
}

/* ------------------------------------------------------- provider model rows */

export function listProviderModels(providerId: string): Promise<ProviderModelResponse[]> {
  return api<ProviderModelResponse[]>(providerModelsKey(providerId));
}

/** Empty `tasks` → the server seeds the heuristic profile (`source: 'inferred'`). */
export function createProviderModel(
  providerId: string,
  model: string,
): Promise<ProviderModelResponse> {
  return api<ProviderModelResponse>('/api/provider-models', {
    body: { provider_id: providerId, model },
  });
}

export function setProviderModelEnabled(
  providerId: string,
  model: string,
  enabled: boolean,
): Promise<ProviderModelResponse> {
  return api<ProviderModelResponse>('/api/provider-models/update', {
    body: { provider_id: providerId, model, enabled },
  });
}

/**
 * Replace a row's task tags (模态能力).
 *
 * The same endpoint carries them, and sending `tasks` makes the server stamp
 * `source: 'user'` — the row stops being re-derived from the model name. Since
 * migration 015 the resolver reads these very rows, so this is what decides
 * which pickers the model shows up in.
 *
 * `traits`, `context_limit`, `protocol`, `connection_role` and `params` are
 * deliberately absent (= keep): those stay desktop-only edits.
 */
export function setProviderModelTasks(
  providerId: string,
  model: string,
  tasks: readonly ModelTask[],
): Promise<ProviderModelResponse> {
  return api<ProviderModelResponse>('/api/provider-models/update', {
    body: buildTasksUpdateBody(providerId, model, tasks),
  });
}

export function deleteProviderModel(providerId: string, model: string): Promise<void> {
  return api<void>('/api/provider-models/delete', {
    body: { provider_id: providerId, model },
  });
}

/* ------------------------------------------------------------ health + resolve */

/** Connectivity test #3: a real inference call; persists `health` on the row. */
export function providerHealthCheck(
  providerId: string,
  model: string,
  task?: ModelTask,
): Promise<ProviderHealthCheckResponse> {
  const payload: Record<string, unknown> = { provider_id: providerId, model };
  if (task) payload.task = task;
  return api<ProviderHealthCheckResponse>('/api/agents/provider-health-check', {
    body: payload,
    timeoutMs: 60_000,
  });
}

/** The authority for every model selector. Returns ENABLED rows only. */
export function resolveModelsForTask(
  task: ModelTask,
  requiredTraits?: ModelTrait[],
): Promise<ResolveModelsResponse> {
  const payload: Record<string, unknown> = { task };
  if (requiredTraits && requiredTraits.length > 0) payload.required_traits = requiredTraits;
  return api<ResolveModelsResponse>('/api/model-profiles/resolve', { body: payload });
}

/* ------------------------------------------------------------ global defaults */

export const DEFAULT_CHAT_MODEL_KEY = 'nomi.defaultModel';
export const TTS_KEY = 'tools.textToSpeech';
export const ASR_KEY = 'tools.speechToText';

function asModelRef(value: unknown): ModelRef | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const providerId = typeof raw.provider_id === 'string' ? raw.provider_id : '';
  const model = typeof raw.model === 'string' ? raw.model : '';
  if (!providerId || !model) return undefined;
  return { provider_id: providerId, model };
}

/** Pick this feature's keys out of the whole client-preference map. */
export function pickClientDefaults(map: Record<string, unknown> | undefined): ClientDefaults {
  if (!map) return {};
  const tts = map[TTS_KEY];
  const asr = map[ASR_KEY];
  return {
    chat: asModelRef(map[DEFAULT_CHAT_MODEL_KEY]),
    tts: tts && typeof tts === 'object' ? (tts as TextToSpeechConfig) : undefined,
    asr: asr && typeof asr === 'object' ? (asr as SpeechToTextConfig) : undefined,
  };
}

/** Write one client preference; `null` DELETES the key (= "no default"). */
export function setClientSetting(key: string, value: unknown): Promise<void> {
  return api<void>(CLIENT_SETTINGS_KEY, { method: 'PUT', body: { [key]: value } });
}
