/**
 * Wire types for 模型管理 (see docs/research/feature-models.md).
 *
 * Three layers that must not be confused:
 *  1. `providers`        — the account/credential entity.
 *  2. `provider_models`  — the authoritative per-model catalog row.
 *  3. `model_profiles`   — (provider_id, model) → tasks/traits.
 *
 * Everything here is snake_case (the managed free-model service is the one
 * camelCase family in the desktop API and is out of scope for this screen).
 */

export type ModelTask =
  | 'chat'
  | 'image_generation'
  | 'image_edit'
  | 'video_generation'
  | 'speech_synthesis'
  | 'speech_recognition'
  | 'embedding'
  | 'rerank';

export type ModelTrait = 'vision_input' | 'function_calling' | 'reasoning' | 'web_search';

/** Display order used by the desktop editors (modelProfileEditing.ts). */
export const MODEL_TASK_ORDER: readonly ModelTask[] = [
  'chat',
  'image_generation',
  'image_edit',
  'video_generation',
  'speech_synthesis',
  'speech_recognition',
  'embedding',
  'rerank',
];

export const MODEL_TRAIT_ORDER: readonly ModelTrait[] = [
  'vision_input',
  'function_calling',
  'reasoning',
  'web_search',
];

export type HealthStatus = 'unknown' | 'healthy' | 'unhealthy';

export interface ModelHealth {
  status: HealthStatus;
  last_check?: number;
  latency?: number;
  error?: string;
}

export interface BedrockConfig {
  auth_method: 'accessKey' | 'profile';
  region: string;
  access_key_id?: string;
  secret_access_key?: string;
  profile?: string;
}

export interface ProviderModelResponse {
  provider_id: string;
  model: string;
  enabled: boolean;
  sort_order: number;
  tasks: ModelTask[];
  traits: ModelTrait[];
  protocol?: string;
  connection_role?: string;
  params?: unknown;
  context_limit?: number;
  description?: string;
  source: 'inferred' | 'user';
  health?: ModelHealth;
  health_checked_at?: number;
  created_at: number;
  updated_at: number;
}

export interface ProviderResponse {
  provider_id: string;
  platform: string;
  name: string;
  base_url: string;
  /** PLAINTEXT. Never render it unless the user explicitly reveals it, never persist it. */
  api_key: string;
  models: string[];
  enabled: boolean;
  sort_order: number;
  is_full_url: boolean;
  created_at: number;
  updated_at: number;
  model_context_limits?: Record<string, number>;
  model_protocols?: Record<string, string>;
  model_descriptions?: Record<string, string>;
  model_enabled?: Record<string, boolean>;
  model_health?: Record<string, ModelHealth>;
  bedrock_config?: BedrockConfig;
  /** Omitted when the provider has no rows. */
  models_detail?: ProviderModelResponse[];
}

/** `POST /api/providers` — build explicitly, the DTO is `deny_unknown_fields`. */
export interface CreateProviderBody {
  platform: string;
  name: string;
  base_url: string;
  api_key: string;
  models?: string[];
  enabled?: boolean;
}

/** `PUT /api/providers/{id}` — partial; only send what changed. */
export interface UpdateProviderBody {
  name?: string;
  base_url?: string;
  api_key?: string;
  enabled?: boolean;
}

export interface DetectProtocolBody {
  base_url: string;
  api_key: string;
  timeout?: number;
  test_all_keys?: boolean;
}

export interface KeyTestResult {
  index: number;
  masked_key: string;
  valid: boolean;
  latency?: number;
  error?: string;
}

export interface MultiKeyResult {
  total: number;
  valid: number;
  invalid: number;
  details: KeyTestResult[];
}

export interface DetectionSuggestion {
  type: 'none' | 'check_key' | 'switch_platform';
  message: string;
  i18n_key?: string;
}

export interface ProtocolDetectionResponse {
  protocol: string;
  confidence: number;
  success: boolean;
  fixed_base_url?: string;
  models?: string[];
  suggestion?: DetectionSuggestion;
  multi_key_result?: MultiKeyResult;
  detectedProtocols?: { protocol: string; confidence: number; models?: string[] }[];
}

export interface ModelInfo {
  id: string;
  name?: string;
}

export interface FetchModelsResponse {
  models: ModelInfo[];
  fixed_base_url?: string;
}

export interface ProviderHealthCheckResponse {
  provider_id: string;
  platform: string;
  model: string;
  status: HealthStatus;
  elapsed_ms: number;
  message?: string;
  error_kind?: string;
  http_status?: number;
  timeout_stage?: string;
}

/** A (provider, model) pair — the shape every persisted model reference uses. */
export interface ModelRef {
  provider_id: string;
  model: string;
}

export interface ResolveModelsResponse {
  models: ModelRef[];
}

/** `tools.textToSpeech` client preference. */
export interface TextToSpeechConfig {
  provider_id?: string;
  model?: string;
  voice?: string | null;
}

/** `tools.speechToText` client preference. */
export interface SpeechToTextConfig {
  enabled?: boolean;
  provider?: string;
  provider_id?: string;
  model?: string;
  language?: string;
}

export interface ClientDefaults {
  chat?: ModelRef;
  tts?: TextToSpeechConfig;
  asr?: SpeechToTextConfig;
}
