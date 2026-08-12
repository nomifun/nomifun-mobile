/**
 * Canonical wire types for the provider/model graph.
 *
 * The desktop and mobile clients share one source of truth:
 *
 *   provider -> models[] -> capabilities[]
 *
 * A model row only owns identity/display metadata.  Every runnable modality
 * is represented by one task-scoped capability, which in turn owns protocol,
 * connection, transport overrides and provider parameters.  Do not add legacy
 * provider-level model maps or model-name heuristics here.
 */

export type ModelTask =
  | 'chat'
  | 'realtime_conversation'
  | 'image_generation'
  | 'image_edit'
  | 'video_generation'
  | 'speech_synthesis'
  | 'speech_recognition'
  | 'embedding'
  | 'rerank';

export type ModelTrait =
  | 'vision_input'
  | 'function_calling'
  | 'reasoning'
  | 'web_search'
  | 'audio_input'
  | 'audio_output'
  | 'video_input'
  | 'realtime'
  | 'streaming';

/** Canonical display and serialization order used by the desktop editor. */
export const MODEL_TASK_ORDER: readonly ModelTask[] = [
  'chat',
  'realtime_conversation',
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
  'video_input',
  'audio_input',
  'audio_output',
  'realtime',
  'streaming',
  'function_calling',
  'reasoning',
  'web_search',
];

export type HealthStatus = 'unknown' | 'healthy' | 'unhealthy';

export interface CapabilityHealth {
  status: HealthStatus;
  latency?: number;
  error?: string;
}

/** Kept for the provider response; secret fields are intentionally absent. */
export interface BedrockConfig {
  auth_method: 'accessKey' | 'profile' | 'defaultChain';
  region: string;
  profile?: string;
}

/** Write-only structured credentials. Responses never contain this value. */
export type ProviderCredentials = Record<string, unknown>;

export interface ProviderModelCapabilityInput {
  task: ModelTask;
  traits?: ModelTrait[];
  protocol: string;
  connection_role: string;
  base_url_override?: string;
  endpoint?: string;
  poll_endpoint?: string;
  content_endpoint?: string;
  realtime_endpoint?: string;
  allow_cross_origin_credentials?: boolean;
  provider_params?: unknown;
  context_limit?: number;
}

export interface ProviderModelCapabilityResponse {
  task: ModelTask;
  traits: ModelTrait[];
  protocol: string;
  connection_role: string;
  base_url_override?: string;
  endpoint?: string;
  poll_endpoint?: string;
  content_endpoint?: string;
  realtime_endpoint?: string;
  allow_cross_origin_credentials: boolean;
  provider_params: unknown;
  context_limit?: number;
  health?: CapabilityHealth;
  health_checked_at?: number;
  created_at: number;
  updated_at: number;
}

export interface ProviderModelInput {
  model: string;
  enabled?: boolean;
  description?: string;
  sort_order?: number;
  capabilities: ProviderModelCapabilityInput[];
}

export interface ProviderModelResponse {
  provider_id: string;
  model: string;
  enabled: boolean;
  sort_order: number;
  description?: string;
  capabilities: ProviderModelCapabilityResponse[];
  created_at: number;
  updated_at: number;
}

export interface ProviderResponse {
  provider_id: string;
  platform: string;
  name: string;
  base_url: string;
  auth_scheme: string;
  has_credentials: boolean;
  models: ProviderModelResponse[];
  enabled: boolean;
  bedrock_config?: BedrockConfig;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface CreateProviderBody {
  platform: string;
  name: string;
  base_url: string;
  auth_scheme: string;
  credentials: ProviderCredentials;
  enabled?: boolean;
  bedrock_config?: BedrockConfig;
  sort_order?: number;
  initial_model: ProviderModelInput;
  connections?: ProviderConnectionInput[];
}

export interface UpdateProviderBody {
  name?: string;
  base_url?: string;
  auth_scheme?: string;
  /** Omit to retain the encrypted credentials already stored. */
  credentials?: ProviderCredentials;
  enabled?: boolean;
  bedrock_config?: BedrockConfig;
  sort_order?: number;
}

export interface ProviderConnectionResponse {
  connection_id: string;
  provider_id: string;
  role: string;
  label?: string;
  base_url: string;
  auth_scheme: string;
  has_credentials: boolean;
  extra: unknown;
  created_at: number;
  updated_at: number;
}

export interface ProviderConnectionInput {
  role: string;
  label?: string | null;
  base_url: string;
  auth_scheme: string;
  credentials: ProviderCredentials;
  extra?: unknown;
}

export interface SaveProviderConnectionBody {
  role: string;
  label?: string | null;
  base_url: string;
  auth_scheme: string;
  /** Omit in edit mode to preserve the existing encrypted secret. */
  credentials?: ProviderCredentials;
  extra?: unknown;
}

export interface SaveProviderModelBody {
  provider_id: string;
  model: ProviderModelInput;
}

export interface ProviderModelKey {
  provider_id: string;
  model: string;
}

export interface ModelInfo {
  id: string;
  name?: string | null;
  tasks?: ModelTask[];
  traits?: ModelTrait[];
}

export interface FetchModelsResponse {
  models: ModelInfo[];
  fixed_base_url?: string;
}

export interface FetchModelsAnonymousBody {
  platform: string;
  base_url: string;
  auth_scheme: string;
  credentials: ProviderCredentials;
  bedrock_config?: BedrockConfig;
  try_fix?: boolean;
}

export interface FetchModelsProviderBody {
  try_fix?: boolean;
}

export interface ProviderHealthCheckResponse {
  provider_id: string;
  platform: string;
  model: string;
  task: ModelTask;
  status: HealthStatus;
  elapsed_ms: number;
  message?: string;
  error_kind?: string;
  http_status?: number;
  timeout_stage?: string;
}

export interface ModelRef {
  provider_id: string;
  model: string;
}

export interface ProtocolEndpointDescriptor {
  task: ModelTask;
  field: string;
  purpose: 'submit' | 'poll' | 'content' | 'session' | string;
  method: string | null;
  default_value: string;
  allowed_placeholders: string[];
  required_placeholders: string[];
  editable: boolean;
}

export interface ProtocolDefaultConnection {
  preset: string;
  platform: string;
  connection_role: string | null;
  connection_label: string | null;
  base_url: string;
  auth_scheme: string;
  requires_credentials: boolean;
}

export interface ProtocolDescriptor {
  protocol_id: string;
  supported_tasks: ModelTask[];
  executor: 'model_invoke' | 'agent' | string;
  transport: 'http' | 'websocket' | 'sdk' | string;
  allowed_auth_schemes: string[];
  scopes: string[];
  platforms: string[];
  default_connections: ProtocolDefaultConnection[];
  endpoints: ProtocolEndpointDescriptor[];
}

export interface AuthSchemeDescriptor {
  scheme: string;
  parameterized: boolean;
}

export interface ProtocolRecommendation {
  protocol_id: string;
  connection_role: string | null;
  default_base_url: string | null;
  default_auth_scheme: string | null;
  base_url_override_required: boolean;
}

export interface ModelProtocolManifestResponse {
  tasks: ModelTask[];
  preset: string;
  platform: string;
  requested_task: ModelTask;
  platform_default_base_url: string | null;
  requires_user_input: boolean;
  default_auth_scheme: string | null;
  auth_schemes: AuthSchemeDescriptor[];
  recommendation: ProtocolRecommendation | null;
  protocols: ProtocolDescriptor[];
}

export interface ProviderConnectionDescriptor {
  role: string;
  label?: string;
  base_url: string;
  auth_scheme: string;
  has_credentials?: boolean;
}

/** `tools.textToSpeech` client preference. */
export interface TextToSpeechConfig {
  provider_id: string;
  model: string;
  /** `null` means that the provider's default voice should be used. */
  voice: string | null;
}

/** `tools.speechToText` client preference. */
export interface SpeechToTextConfig {
  enabled: boolean;
  provider_id?: string;
  model?: string;
  language?: string;
  auto_send?: boolean;
}

export interface ClientDefaults {
  chat?: ModelRef;
  imageGeneration?: ModelRef;
  tts?: TextToSpeechConfig;
  asr?: SpeechToTextConfig;
}
