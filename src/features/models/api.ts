/**
 * HTTP surface for the canonical provider/model graph.
 *
 * Bodies are assembled explicitly because the desktop backend uses strict
 * deny-unknown-fields DTOs.  In particular, credentials are typed write-only
 * JSON and are never read back or copied from a response object.
 */
import { api } from '@/api/client';

import type {
  ClientDefaults,
  CreateProviderBody,
  FetchModelsAnonymousBody,
  FetchModelsProviderBody,
  FetchModelsResponse,
  ModelProtocolManifestResponse,
  ModelRef,
  ModelTask,
  ModelTrait,
  ProviderConnectionResponse,
  ProviderHealthCheckResponse,
  ProviderModelKey,
  ProviderModelResponse,
  ProviderResponse,
  SaveProviderConnectionBody,
  SaveProviderModelBody,
  SpeechToTextConfig,
  TextToSpeechConfig,
  UpdateProviderBody,
} from './types';
import { capabilityInputFromResponse as capabilityInputFromAdvancedResponse } from './advanced';

export const PROVIDERS_KEY = '/api/providers';
export const CLIENT_SETTINGS_KEY = '/api/settings/client';
export const PROVIDER_MODELS_KEY = '/api/provider-models';

export const providerModelsKey = (providerId: string): string =>
  `${PROVIDER_MODELS_KEY}?provider_id=${encodeURIComponent(providerId)}`;

export const providerConnectionsKey = (providerId: string): string =>
  `${PROVIDERS_KEY}/${encodeURIComponent(providerId)}/connections`;

export const modelProtocolsKey = (
  preset: string,
  task: ModelTask,
  baseUrl?: string,
): string => {
  const query = new URLSearchParams({ preset, task });
  if (baseUrl?.trim()) query.set('base_url', baseUrl.trim());
  return `/api/model-protocols?${query.toString()}`;
};

/* ---------------------------------------------------------------- providers */

export function listProviders(): Promise<ProviderResponse[]> {
  return api<ProviderResponse[]>(PROVIDERS_KEY);
}

export function createProvider(body: CreateProviderBody): Promise<ProviderResponse> {
  const payload: Record<string, unknown> = {
    platform: body.platform,
    name: body.name,
    base_url: body.base_url,
    auth_scheme: body.auth_scheme,
    credentials: body.credentials,
    initial_model: body.initial_model,
  };
  if (body.enabled !== undefined) payload.enabled = body.enabled;
  if (body.bedrock_config !== undefined) payload.bedrock_config = body.bedrock_config;
  if (body.sort_order !== undefined) payload.sort_order = body.sort_order;
  if (body.connections !== undefined) payload.connections = body.connections;
  return api<ProviderResponse>(PROVIDERS_KEY, { body: payload });
}

export function updateProvider(
  providerId: string,
  patch: UpdateProviderBody,
): Promise<ProviderResponse> {
  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.base_url !== undefined) payload.base_url = patch.base_url;
  if (patch.auth_scheme !== undefined) payload.auth_scheme = patch.auth_scheme;
  if (patch.credentials !== undefined) payload.credentials = patch.credentials;
  if (patch.enabled !== undefined) payload.enabled = patch.enabled;
  if (patch.bedrock_config !== undefined) payload.bedrock_config = patch.bedrock_config;
  if (patch.sort_order !== undefined) payload.sort_order = patch.sort_order;
  return api<ProviderResponse>(`${PROVIDERS_KEY}/${encodeURIComponent(providerId)}`, {
    method: 'PUT',
    body: payload,
  });
}

export function deleteProvider(providerId: string): Promise<void> {
  return api<void>(`${PROVIDERS_KEY}/${encodeURIComponent(providerId)}`, { method: 'DELETE' });
}

export function cloneProvider(providerId: string, name?: string): Promise<ProviderResponse> {
  const body = name?.trim() ? { name: name.trim() } : undefined;
  return api<ProviderResponse>(`${PROVIDERS_KEY}/${encodeURIComponent(providerId)}/clone`, {
    method: 'POST',
    body,
  });
}

/* ---------------------------------------------------------- model discovery */

export function fetchProviderModels(
  providerId: string,
  tryFix = false,
): Promise<FetchModelsResponse> {
  return api<FetchModelsResponse>(`${PROVIDERS_KEY}/${encodeURIComponent(providerId)}/models`, {
    body: { try_fix: tryFix } satisfies FetchModelsProviderBody,
    timeoutMs: 20_000,
  });
}

export function fetchModelsAnonymous(input: FetchModelsAnonymousBody): Promise<FetchModelsResponse> {
  const body: Record<string, unknown> = {
    platform: input.platform,
    base_url: input.base_url,
    auth_scheme: input.auth_scheme,
    credentials: input.credentials,
    try_fix: input.try_fix ?? false,
  };
  if (input.bedrock_config !== undefined) body.bedrock_config = input.bedrock_config;
  return api<FetchModelsResponse>(`${PROVIDERS_KEY}/fetch-models`, {
    body,
    timeoutMs: 20_000,
  });
}

/* -------------------------------------------------------- provider models */

export function listProviderModels(providerId?: string): Promise<ProviderModelResponse[]> {
  return api<ProviderModelResponse[]>(
    providerId ? providerModelsKey(providerId) : PROVIDER_MODELS_KEY,
  );
}

/** Full atomic replacement of one model and all of its capabilities. */
export function saveProviderModel(body: SaveProviderModelBody): Promise<ProviderModelResponse> {
  return api<ProviderModelResponse>(PROVIDER_MODELS_KEY, {
    method: 'PUT',
    body: {
      provider_id: body.provider_id,
      model: body.model,
    },
  });
}

export function createProviderModel(
  providerId: string,
  model: {
    model: string;
    enabled?: boolean;
    description?: string;
    sort_order?: number;
    capabilities: SaveProviderModelBody['model']['capabilities'];
  },
): Promise<ProviderModelResponse> {
  return saveProviderModel({ provider_id: providerId, model });
}

export function setProviderModelEnabled(
  providerId: string,
  row: ProviderModelResponse,
  enabled: boolean,
): Promise<ProviderModelResponse> {
  return saveProviderModel({
    provider_id: providerId,
    model: {
      model: row.model,
      enabled,
      ...(row.description === undefined ? {} : { description: row.description }),
      sort_order: row.sort_order,
      capabilities: row.capabilities.map(capabilityInputFromAdvancedResponse),
    },
  });
}

export function deleteProviderModel(providerId: string, model: string): Promise<void> {
  const key: ProviderModelKey = { provider_id: providerId, model };
  return api<void>(
    `${PROVIDER_MODELS_KEY}?provider_id=${encodeURIComponent(key.provider_id)}&model=${encodeURIComponent(
      key.model,
    )}`,
    { method: 'DELETE' },
  );
}

/* ---------------------------------------------------------- connections */

export function listProviderConnections(providerId: string): Promise<ProviderConnectionResponse[]> {
  return api<ProviderConnectionResponse[]>(providerConnectionsKey(providerId));
}

export function saveProviderConnection(
  providerId: string,
  body: SaveProviderConnectionBody,
): Promise<ProviderConnectionResponse> {
  const payload: Record<string, unknown> = {
    role: body.role,
    base_url: body.base_url,
    auth_scheme: body.auth_scheme,
  };
  if (body.label !== undefined) payload.label = body.label;
  if (body.credentials !== undefined) payload.credentials = body.credentials;
  if (body.extra !== undefined) payload.extra = body.extra;
  return api<ProviderConnectionResponse>(providerConnectionsKey(providerId), {
    method: 'PUT',
    body: payload,
  });
}

export function deleteProviderConnection(providerId: string, role: string): Promise<void> {
  return api<void>(
    `${providerConnectionsKey(providerId)}/${encodeURIComponent(role)}`,
    { method: 'DELETE' },
  );
}

/* ------------------------------------------------------ protocol manifests */

export function fetchModelProtocolManifest(
  preset: string,
  task: ModelTask,
  baseUrl?: string,
): Promise<ModelProtocolManifestResponse> {
  return api<ModelProtocolManifestResponse>(modelProtocolsKey(preset, task, baseUrl));
}

/* -------------------------------------------------------------- health */

export function providerHealthCheck(
  providerId: string,
  model: string,
  task: ModelTask,
): Promise<ProviderHealthCheckResponse> {
  return api<ProviderHealthCheckResponse>('/api/agents/provider-health-check', {
    body: { provider_id: providerId, model, task },
    timeoutMs: 60_000,
  });
}

/* ----------------------------------------------------- client preferences */

export const DEFAULT_CHAT_MODEL_KEY = 'nomi.defaultModel';
export const DEFAULT_IMAGE_MODEL_KEY = 'models.default.imageGeneration';
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

function asTextToSpeechConfig(value: unknown): TextToSpeechConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const ref = asModelRef(raw);
  if (!ref) return undefined;
  const voice =
    raw.voice === undefined || raw.voice === null
      ? null
      : typeof raw.voice === 'string'
        ? raw.voice
        : undefined;
  if (voice === undefined) return undefined;
  return { ...ref, voice };
}

function asSpeechToTextConfig(value: unknown): SpeechToTextConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.enabled !== 'boolean') return undefined;
  const providerId =
    raw.provider_id === undefined || raw.provider_id === null
      ? undefined
      : typeof raw.provider_id === 'string' && raw.provider_id.trim()
        ? raw.provider_id
        : undefined;
  const model =
    raw.model === undefined || raw.model === null
      ? undefined
      : typeof raw.model === 'string' && raw.model.trim()
        ? raw.model
        : undefined;
  // The backend validates this as an optional pair. Do not expose a half
  // reference as a selectable current value.
  if ((providerId && !model) || (!providerId && model)) return undefined;
  const language =
    raw.language === undefined || raw.language === null
      ? undefined
      : typeof raw.language === 'string'
        ? raw.language
        : undefined;
  if (raw.language !== undefined && raw.language !== null && language === undefined) {
    return undefined;
  }
  const autoSend =
    raw.auto_send === undefined || raw.auto_send === null
      ? undefined
      : typeof raw.auto_send === 'boolean'
        ? raw.auto_send
        : undefined;
  if (raw.auto_send !== undefined && raw.auto_send !== null && autoSend === undefined) {
    return undefined;
  }
  return {
    enabled: raw.enabled,
    ...(providerId && model ? { provider_id: providerId, model } : {}),
    ...(language === undefined ? {} : { language }),
    ...(autoSend === undefined ? {} : { auto_send: autoSend }),
  };
}

export function pickClientDefaults(map: Record<string, unknown> | undefined): ClientDefaults {
  if (!map) return {};
  const tts = map[TTS_KEY];
  const asr = map[ASR_KEY];
  return {
    chat: asModelRef(map[DEFAULT_CHAT_MODEL_KEY]),
    imageGeneration: asModelRef(map[DEFAULT_IMAGE_MODEL_KEY]),
    tts: asTextToSpeechConfig(tts),
    asr: asSpeechToTextConfig(asr),
  };
}

export function setClientSetting(key: string, value: unknown): Promise<void> {
  return api<void>(CLIENT_SETTINGS_KEY, { method: 'PUT', body: { [key]: value } });
}
