/**
 * UI-free port of the desktop providerModelAdvanced helpers.
 *
 * The mobile editor has a different layout, but it keeps the same invariants:
 * primary-task-first selection, task-scoped catalog traits, atomic protocol
 * changes, explicit cross-origin consent, and strict capability serialization.
 */
import {
  MODEL_TASK_ORDER,
  MODEL_TRAIT_ORDER,
  type ModelProtocolManifestResponse,
  type ModelTask,
  type ModelTrait,
  type ProviderConnectionDescriptor,
  type ProviderModelCapabilityInput,
} from './types';

export type ModelProtocolManifest = ModelProtocolManifestResponse;
export type ModelProtocolManifestMap = Partial<Record<ModelTask, ModelProtocolManifest>>;

export const CAPABILITY_ENDPOINT_FIELDS = [
  'endpoint',
  'poll_endpoint',
  'content_endpoint',
  'realtime_endpoint',
] as const;

export type CapabilityEndpointField = (typeof CAPABILITY_ENDPOINT_FIELDS)[number];

export interface ModelCapabilityDraft {
  task: ModelTask;
  traits: ModelTrait[];
  protocol: string;
  connectionRole: string;
  baseUrlOverride: string;
  endpoint: string;
  pollEndpoint: string;
  contentEndpoint: string;
  realtimeEndpoint: string;
  allowCrossOriginCredentials: boolean;
  providerParamsJson: string;
  contextLimit?: number;
}

export interface ModelDefinitionDraft {
  model: string;
  enabled?: boolean;
  description?: string;
  sortOrder?: number;
  capabilities: ModelCapabilityDraft[];
}

export interface CatalogCapabilitySuggestion {
  model: string;
  tasks: ModelTask[];
  traits: ModelTrait[];
  label?: string;
}

export type CapabilityValidationError =
  | 'model_required'
  | 'duplicate_model'
  | 'capability_required'
  | 'manifest_loading'
  | 'manifest_unavailable'
  | 'protocol_required'
  | 'protocol_not_registered'
  | 'protocol_wrong_task'
  | 'auth_scheme_incompatible'
  | 'connection_role_required'
  | 'connection_missing'
  | 'base_url_required'
  | 'cross_origin_consent_required'
  | 'invalid_provider_params';

export interface CapabilityValidationResult {
  valid: boolean;
  errors: Array<{ task?: ModelTask; code: CapabilityValidationError }>;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const normalizeModelId = (value: string): string => value.trim();

export const emptyCapabilityDraft = (task: ModelTask): ModelCapabilityDraft => ({
  task,
  traits: [],
  protocol: '',
  connectionRole: 'default',
  baseUrlOverride: '',
  endpoint: '',
  pollEndpoint: '',
  contentEndpoint: '',
  realtimeEndpoint: '',
  allowCrossOriginCredentials: false,
  providerParamsJson: '',
  contextLimit: undefined,
});

export const capabilityDraftFromResponse = (capability: {
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
}): ModelCapabilityDraft => ({
  task: capability.task,
  traits: capability.traits ? [...capability.traits] : [],
  protocol: capability.protocol,
  connectionRole: capability.connection_role,
  baseUrlOverride: capability.base_url_override ?? '',
  endpoint: capability.endpoint ?? '',
  pollEndpoint: capability.poll_endpoint ?? '',
  contentEndpoint: capability.content_endpoint ?? '',
  realtimeEndpoint: capability.realtime_endpoint ?? '',
  allowCrossOriginCredentials: capability.allow_cross_origin_credentials ?? false,
  providerParamsJson:
    isPlainObject(capability.provider_params) &&
    Object.keys(capability.provider_params).length > 0
      ? JSON.stringify(capability.provider_params, null, 2)
      : '',
  contextLimit: capability.context_limit,
});

export const addCapabilityTask = (
  capabilities: readonly ModelCapabilityDraft[],
  task: ModelTask,
): ModelCapabilityDraft[] =>
  capabilities.some((capability) => capability.task === task)
    ? [...capabilities]
    : [...capabilities, emptyCapabilityDraft(task)];

export const removeCapabilityTask = (
  capabilities: readonly ModelCapabilityDraft[],
  task: ModelTask,
): ModelCapabilityDraft[] => capabilities.filter((capability) => capability.task !== task);

export const catalogSuggestionsForTask = <T extends { tasks: readonly ModelTask[] }>(
  suggestions: readonly T[],
  task: ModelTask | undefined,
): T[] => (task ? suggestions.filter((suggestion) => suggestion.tasks.includes(task)) : []);

const CATALOG_TRAITS_BY_TASK: Readonly<Record<ModelTask, readonly ModelTrait[]>> = {
  chat: [
    'vision_input',
    'video_input',
    'audio_input',
    'audio_output',
    'streaming',
    'function_calling',
    'reasoning',
    'web_search',
  ],
  realtime_conversation: ['audio_input', 'audio_output', 'realtime', 'streaming'],
  image_generation: [],
  image_edit: [],
  video_generation: [],
  speech_synthesis: [],
  speech_recognition: [],
  embedding: [],
  rerank: [],
};

export const applyCatalogSuggestionForTask = (
  definition: ModelDefinitionDraft,
  suggestion: CatalogCapabilitySuggestion,
  task: ModelTask,
): ModelDefinitionDraft => ({
  ...definition,
  model: suggestion.model,
  capabilities: [
    {
      ...emptyCapabilityDraft(task),
      traits: suggestion.tasks.includes(task)
        ? MODEL_TRAIT_ORDER.filter(
            (trait) =>
              suggestion.traits.includes(trait) &&
              CATALOG_TRAITS_BY_TASK[task].includes(trait),
          )
        : [],
    },
  ],
});

export const changePrimaryModelTask = (
  definition: ModelDefinitionDraft,
  task: ModelTask,
): ModelDefinitionDraft => ({
  ...definition,
  model: definition.capabilities.length === 0 ? definition.model : '',
  capabilities: [emptyCapabilityDraft(task)],
});

export const changeCapabilityProtocol = (
  capability: ModelCapabilityDraft,
  protocol: string,
  manifest?: ModelProtocolManifest,
): ModelCapabilityDraft => {
  const nextProtocol = protocol.trim();
  if (nextProtocol === capability.protocol.trim()) return capability;
  const recommendation = manifest?.recommendation;
  const recommended = recommendation?.protocol_id === nextProtocol;
  const connectionRole = recommended
    ? recommendation?.connection_role || 'default'
    : 'default';
  const baseUrlOverride =
    recommended &&
    connectionRole === 'default' &&
    recommendation?.base_url_override_required &&
    recommendation.default_base_url
      ? recommendation.default_base_url
      : '';
  return {
    ...capability,
    protocol: nextProtocol,
    connectionRole,
    baseUrlOverride,
    endpoint: '',
    pollEndpoint: '',
    contentEndpoint: '',
    realtimeEndpoint: '',
    allowCrossOriginCredentials: false,
    providerParamsJson: '',
  };
};

export const reconcileCapabilityRecommendations = (
  capabilities: readonly ModelCapabilityDraft[],
  manifests: ModelProtocolManifestMap,
): ModelCapabilityDraft[] =>
  capabilities.map((capability) => {
    const recommendation = manifests[capability.task]?.recommendation;
    if (!recommendation) return capability;
    const untouched = !capability.protocol.trim();
    const protocol = capability.protocol || recommendation.protocol_id;
    const connectionRole = untouched
      ? recommendation.connection_role || 'default'
      : capability.connectionRole || recommendation.connection_role || 'default';
    const baseUrlOverride =
      !capability.baseUrlOverride &&
      connectionRole === 'default' &&
      recommendation.base_url_override_required &&
      recommendation.default_base_url
        ? recommendation.default_base_url
        : capability.baseUrlOverride;
    return protocol === capability.protocol &&
      connectionRole === capability.connectionRole &&
      baseUrlOverride === capability.baseUrlOverride
      ? capability
      : { ...capability, protocol, connectionRole, baseUrlOverride };
  });

export const protocolDescriptorForDraft = (
  capability: ModelCapabilityDraft,
  manifest?: ModelProtocolManifest,
) =>
  manifest?.protocols.find(
    (descriptor) => descriptor.protocol_id === capability.protocol,
  );

export const isProtocolAuthSchemeAllowed = (
  authScheme: string,
  allowedAuthSchemes: readonly string[],
): boolean => {
  const normalized = authScheme.trim();
  if (allowedAuthSchemes.length === 0) return true;
  if (!normalized) return false;
  return allowedAuthSchemes.some((allowed) => {
    if (allowed === normalized) return true;
    if (allowed === 'header_key:<name>') {
      return (
        normalized.startsWith('header_key:') &&
        normalized.slice('header_key:'.length).trim().length > 0
      );
    }
    if (allowed === 'query_key:<param>') {
      return (
        normalized.startsWith('query_key:') &&
        normalized.slice('query_key:'.length).trim().length > 0
      );
    }
    return false;
  });
};

export const effectiveBaseUrl = (
  capability: ModelCapabilityDraft,
  _manifest: ModelProtocolManifest | undefined,
  providerBaseUrl: string,
  connections: readonly ProviderConnectionDescriptor[] = [],
): string => {
  if (capability.baseUrlOverride.trim()) return capability.baseUrlOverride.trim();
  const role = capability.connectionRole.trim() || 'default';
  if (role !== 'default') {
    return connections.find((connection) => connection.role === role)?.base_url.trim() ?? '';
  }
  return providerBaseUrl.trim();
};

export const endpointDescriptorValue = (
  capability: ModelCapabilityDraft,
  descriptor: { field: string; default_value: string },
): string => {
  switch (descriptor.field) {
    case 'endpoint':
      return capability.endpoint || descriptor.default_value || '';
    case 'poll_endpoint':
      return capability.pollEndpoint || descriptor.default_value || '';
    case 'content_endpoint':
      return capability.contentEndpoint || descriptor.default_value || '';
    case 'realtime_endpoint':
      return capability.realtimeEndpoint || descriptor.default_value || '';
    default:
      return '';
  }
};

const urlOrigin = (value: string): string | undefined => {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) return undefined;
    const protocol =
      parsed.protocol === 'ws:'
        ? 'http:'
        : parsed.protocol === 'wss:'
          ? 'https:'
          : parsed.protocol;
    return `${protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return undefined;
  }
};

export const requiresCrossOriginConsent = (
  capability: ModelCapabilityDraft,
  manifest: ModelProtocolManifest | undefined,
  providerBaseUrl: string,
  connections: readonly ProviderConnectionDescriptor[] = [],
): boolean => {
  const role = capability.connectionRole.trim() || 'default';
  const credentialBaseUrl =
    role === 'default'
      ? providerBaseUrl
      : connections.find((connection) => connection.role === role)?.base_url ?? '';
  const credentialOrigin = urlOrigin(credentialBaseUrl);
  if (!credentialOrigin) return false;
  const candidates = [
    effectiveBaseUrl(capability, manifest, providerBaseUrl, connections),
    capability.endpoint,
    capability.pollEndpoint,
    capability.contentEndpoint,
    capability.realtimeEndpoint,
  ];
  return candidates.some((candidate) => {
    const origin = urlOrigin(candidate.trim());
    return origin !== undefined && origin !== credentialOrigin;
  });
};

export const parseProviderParams = (
  raw: string,
): { ok: true; value: Record<string, unknown> } | { ok: false } => {
  if (!raw.trim()) return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? { ok: true, value: parsed } : { ok: false };
  } catch {
    return { ok: false };
  }
};

export const isDuplicateModelId = (
  value: string,
  existing: readonly string[],
): boolean => {
  const normalized = normalizeModelId(value);
  return (
    normalized.length > 0 &&
    existing.some((candidate) => normalizeModelId(candidate) === normalized)
  );
};

export const validateModelDefinition = (
  definition: ModelDefinitionDraft,
  manifests: ModelProtocolManifestMap,
  providerBaseUrl: string,
  existingModelIds: readonly string[] = [],
  loadingTasks: readonly ModelTask[] = [],
  availableConnectionRoles: readonly string[] = [],
  providerAuthScheme = '',
  connectionAuthSchemes: Readonly<Record<string, string>> = {},
  connections: readonly ProviderConnectionDescriptor[] = [],
): CapabilityValidationResult => {
  const errors: CapabilityValidationResult['errors'] = [];
  const model = normalizeModelId(definition.model);
  if (!model) errors.push({ code: 'model_required' });
  else if (isDuplicateModelId(model, existingModelIds)) {
    errors.push({ code: 'duplicate_model' });
  }
  if (definition.capabilities.length === 0) {
    errors.push({ code: 'capability_required' });
  }

  for (const capability of definition.capabilities) {
    if (loadingTasks.includes(capability.task)) {
      errors.push({ task: capability.task, code: 'manifest_loading' });
      continue;
    }
    const manifest = manifests[capability.task];
    if (!manifest) {
      errors.push({ task: capability.task, code: 'manifest_unavailable' });
      continue;
    }
    const protocol = capability.protocol.trim();
    const descriptor = protocolDescriptorForDraft(capability, manifest);
    if (!protocol) {
      errors.push({ task: capability.task, code: 'protocol_required' });
    } else if (!descriptor) {
      errors.push({ task: capability.task, code: 'protocol_not_registered' });
    } else if (!descriptor.supported_tasks.includes(capability.task)) {
      errors.push({ task: capability.task, code: 'protocol_wrong_task' });
    }

    const role = capability.connectionRole.trim();
    if (!role) {
      errors.push({ task: capability.task, code: 'connection_role_required' });
    } else if (role !== 'default' && !availableConnectionRoles.includes(role)) {
      errors.push({ task: capability.task, code: 'connection_missing' });
    }

    const selectedAuthScheme =
      role === 'default'
        ? providerAuthScheme
        : connectionAuthSchemes[role] ?? '';
    if (
      descriptor &&
      selectedAuthScheme &&
      !isProtocolAuthSchemeAllowed(
        selectedAuthScheme,
        descriptor.allowed_auth_schemes,
      )
    ) {
      errors.push({ task: capability.task, code: 'auth_scheme_incompatible' });
    }

    const connectionResolvable = role === 'default' || availableConnectionRoles.includes(role);
    const connectionUrlKnown = role === 'default' || connections.some((connection) => connection.role === role);
    if (
      descriptor?.transport !== 'sdk' &&
      connectionResolvable &&
      connectionUrlKnown &&
      !effectiveBaseUrl(capability, manifest, providerBaseUrl, connections).trim()
    ) {
      errors.push({ task: capability.task, code: 'base_url_required' });
    }
    if (
      requiresCrossOriginConsent(capability, manifest, providerBaseUrl, connections) &&
      !capability.allowCrossOriginCredentials
    ) {
      errors.push({ task: capability.task, code: 'cross_origin_consent_required' });
    }
    if (!parseProviderParams(capability.providerParamsJson).ok) {
      errors.push({ task: capability.task, code: 'invalid_provider_params' });
    }
  }
  return { valid: errors.length === 0, errors };
};

const optionalTrimmed = (value: string): string | undefined =>
  value.trim() || undefined;

export const capabilityInputFromDraft = (
  capability: ModelCapabilityDraft,
): ProviderModelCapabilityInput | undefined => {
  const params = parseProviderParams(capability.providerParamsJson);
  if (!params.ok) return undefined;
  const input: ProviderModelCapabilityInput = {
    task: capability.task,
    protocol: capability.protocol.trim(),
    connection_role: capability.connectionRole.trim(),
  };
  if (capability.traits.length > 0) input.traits = [...capability.traits];
  const baseUrl = optionalTrimmed(capability.baseUrlOverride);
  const endpoint = optionalTrimmed(capability.endpoint);
  const poll = optionalTrimmed(capability.pollEndpoint);
  const content = optionalTrimmed(capability.contentEndpoint);
  const realtime = optionalTrimmed(capability.realtimeEndpoint);
  if (baseUrl) input.base_url_override = baseUrl;
  if (endpoint) input.endpoint = endpoint;
  if (poll) input.poll_endpoint = poll;
  if (content) input.content_endpoint = content;
  if (realtime) input.realtime_endpoint = realtime;
  if (capability.allowCrossOriginCredentials) input.allow_cross_origin_credentials = true;
  if (Object.keys(params.value).length > 0) input.provider_params = params.value;
  if (capability.contextLimit !== undefined && capability.contextLimit > 0) {
    input.context_limit = capability.contextLimit;
  }
  return input;
};

export const capabilityInputsFromDefinition = (
  definition: ModelDefinitionDraft,
): ProviderModelCapabilityInput[] | undefined => {
  const capabilities = definition.capabilities.map(capabilityInputFromDraft);
  return capabilities.every(
    (capability): capability is ProviderModelCapabilityInput => capability !== undefined,
  )
    ? capabilities
    : undefined;
};

export const capabilityInputFromResponse = (
  capability: Parameters<typeof capabilityDraftFromResponse>[0],
): ProviderModelCapabilityInput =>
  capabilityInputFromDraft(capabilityDraftFromResponse(capability))!;

export const sortTasks = (tasks: readonly ModelTask[]): ModelTask[] =>
  MODEL_TASK_ORDER.filter((task) => tasks.includes(task));

export const sortTraits = (traits: readonly ModelTrait[]): ModelTrait[] =>
  MODEL_TRAIT_ORDER.filter((trait) => traits.includes(trait));
