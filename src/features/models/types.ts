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
  | 'music_generation'
  | 'speech_synthesis'
  | 'speech_recognition'
  | 'embedding'
  | 'rerank';

export type ModelTrait =
  | 'vision_input'
  | 'web_search'
  | 'audio_input'
  | 'video_input';

export type ModelTechnicalCapability = 'function_calling' | 'reasoning' | 'streaming';
export type ModelContextLimitKind = 'input_only' | 'combined';

/** Canonical display and serialization order used by the desktop editor. */
export const MODEL_TASK_ORDER: readonly ModelTask[] = [
  'chat',
  'realtime_conversation',
  'image_generation',
  'image_edit',
  'video_generation',
  'music_generation',
  'speech_synthesis',
  'speech_recognition',
  'embedding',
  'rerank',
];

export const MODEL_TRAIT_ORDER: readonly ModelTrait[] = [
  'vision_input',
  'video_input',
  'audio_input',
  'web_search',
];

export type HealthStatus = 'unknown' | 'healthy' | 'unhealthy';

export interface CapabilityHealth {
  status: HealthStatus;
  latency?: number;
  error?: string;
  error_kind?: string;
  http_status?: number;
  attempted_url?: string;
  unsupported_technical_capabilities?: ModelTechnicalCapability[];
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
  output_limit?: number;
  compaction_threshold_pct?: number;
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
  output_limit?: number;
  compaction_threshold_pct?: number;
  health?: CapabilityHealth;
  health_checked_at?: number;
  created_at: number;
  updated_at: number;
}

export interface ProviderModelInput {
  model: string;
  display_name?: string | null;
  enabled?: boolean;
  description?: string | null;
  sort_order?: number;
  capabilities: ProviderModelCapabilityInput[];
}

export interface ProviderModelResponse {
  provider_id: string;
  model: string;
  display_name?: string;
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
  provider_id?: string;
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
  tasks_source?: 'provider_declared' | 'official_documentation' | 'inferred';
  traits?: ModelTrait[];
  context_limit?: number;
  output_limit?: number;
  token_limit_sources?: {
    context_limit?: string;
    output_limit?: string;
    context_limit_kind?: ModelContextLimitKind;
  };
}

export interface FetchModelsResponse {
  models: ModelInfo[];
  catalog_source?: 'remote' | 'official_documentation';
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
  attempted_url?: string;
}

export type ProviderReachability =
  | 'reachable'
  | 'credentials_rejected'
  | 'unreachable';

export type EndpointRootShape = 'versioned_root' | 'origin_root';

export interface ProbeCandidateResult {
  base_url: string;
  attempted_url: string;
  reachability: ProviderReachability;
  http_status?: number;
  content_type?: string;
}

export interface ProbeProviderConnectionRequest {
  protocol?: string;
  task?: ModelTask;
  /** Required for protocols whose endpoint embeds `{model}`. */
  model?: string;
  probe_candidates: boolean;
}

export interface ProbeProviderConnectionAnonymousBody {
  platform: string;
  base_url: string;
  auth_scheme: string;
  credentials: ProviderCredentials;
  protocol?: string;
  task?: ModelTask;
  /** Required for protocols whose endpoint embeds `{model}`. */
  model?: string;
  probe_candidates: boolean;
}

export interface ProbeProviderConnectionResponse {
  reachability: ProviderReachability;
  protocol: string;
  task: ModelTask;
  root_shape: EndpointRootShape;
  attempted_url: string;
  http_status?: number;
  error_kind?: string;
  content_type?: string;
  message?: string;
  elapsed_ms: number;
  suggested_base_url?: string;
  candidates?: ProbeCandidateResult[];
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
  root_shape?: EndpointRootShape;
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
  /** Newer desktop builds require an explicit output ceiling for this protocol. */
  requires_output_ceiling?: boolean;
  root_shape?: EndpointRootShape | null;
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
  model_defaults?: ModelConfigurationDefaults;
}

export interface ModelConfigurationDefaults {
  model: string;
  protocol_id: string;
  context_limit?: number;
  context_limit_kind?: ModelContextLimitKind;
  output_limit?: number;
  provider_params: Record<string, unknown>;
  reasoning_efforts?: string[];
  sources: string[];
  checked_at: string;
}

export interface DiscoverModelProtocolsRequest {
  model: string;
  capability: ProviderModelCapabilityInput;
  preferred_protocol?: string;
  apply_recommended_defaults?: boolean;
}

export interface DiscoverModelProtocolsAnonymousRequest extends DiscoverModelProtocolsRequest {
  platform: string;
  base_url: string;
  auth_scheme: string;
  credentials: ProviderCredentials;
  connections?: ProviderConnectionInput[];
  bedrock_config?: BedrockConfig;
}

export interface ModelProtocolCandidate {
  protocol: string;
  capability?: ProviderModelCapabilityInput;
  status: 'available' | 'incompatible' | 'inconclusive' | 'blocked';
  evidence: 'verified_stream' | 'official_model' | 'catalog_task' | 'registered_only';
  recommended: boolean;
  probe_output_limit?: number;
  message?: string;
  error_kind?: string;
  http_status?: number;
  elapsed_ms: number;
}

export interface DiscoverModelProtocolsResponse {
  selected_protocol?: string;
  selected_capability?: ProviderModelCapabilityInput;
  candidates: ModelProtocolCandidate[];
  elapsed_ms: number;
  config_revision?: number;
}

export interface ModelGatewayOperator {
  name: string;
  homepage_url: string | null;
  console_url: string | null;
  purchase_url: string | null;
  terms_url: string | null;
  privacy_url: string | null;
}

export interface ModelGatewayMetaResponse {
  contract_version: string;
  operator: ModelGatewayOperator;
  capabilities: string[];
  optional_endpoints: string[];
}

/** Monetary, quota and rate values are lossless decimal strings on the desktop API. */
export interface ModelGatewayPrice {
  task: ModelTask;
  meter: string;
  unit_size: string;
  amount: string;
  currency: string;
}

export interface ModelGatewayCatalogModel {
  id: string;
  display_name: string;
  vendor: string;
  tasks: ModelTask[];
  task_endpoints: Record<string, { endpoints: string[]; preferred_endpoint: string }>;
  context_window: number | null;
  max_output_tokens: number | null;
  input_modalities: string[];
  traits: string[];
  pricing: ModelGatewayPrice[];
  included_in_plan: boolean;
  status: string;
}

export interface ModelGatewayCatalogResponse {
  contract_version: string;
  models: ModelGatewayCatalogModel[];
  imports: ProviderModelInput[];
}

export interface ModelGatewayAccountResponse {
  contract_version: string;
  plan: {
    name: string;
    period_start: string | null;
    period_end: string | null;
    quota: { unit: string; total: string | null; used: string };
  } | null;
  balance: { amount: string; currency: string };
  key: { name: string; expires_at: string | null; quota_unit: string; remaining_quota: string | null };
  rate_limits: {
    requests_per_minute: string | null;
    tokens_per_minute: string | null;
    concurrent_requests: string | null;
  };
}

export interface CreateModelGatewayRequest {
  base_url: string;
  api_key: string;
  name: string;
  models: string[];
}

export interface UpdateModelGatewayConnectionRequest {
  base_url: string;
  api_key?: string | null;
  name?: string | null;
}

export interface SyncModelGatewayResponse {
  added: number;
  updated: number;
  models: ProviderModelResponse[];
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
