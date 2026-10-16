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
  type EndpointRootShape,
  type ModelConfigurationDefaults,
  type ModelInfo,
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
  /**
   * UI-only ownership marker. Automatic recommendations may update blank
   * transport fields, but must never overwrite a persisted or user-edited
   * capability.
   */
  transportSource: 'blank' | 'recommendation' | 'auto' | 'user' | 'persisted';
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
  outputLimit?: number;
  compactionThresholdPct?: number;
  contextLimitSource?: 'user';
  outputLimitSource?: 'user';
  providerParamsSource?: 'user';
  modelDefaults?: { model: string; contextLimit?: number; outputLimit?: number; providerParams: Record<string, unknown> };
}

export interface ModelDefinitionDraft {
  model: string;
  displayName?: string;
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
  tasksSource?: 'provider_declared' | 'official_documentation' | 'inferred';
  contextLimit?: number;
  outputLimit?: number;
  contextLimitKind?: 'input_only' | 'combined';
  tokenLimitSources?: ModelInfo['token_limit_sources'];
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
  | 'output_ceiling_required'
  | 'invalid_token_limit'
  | 'invalid_compaction_threshold'
  | 'cross_origin_consent_required'
  | 'invalid_provider_params';

export interface CapabilityValidationResult {
  valid: boolean;
  errors: Array<{ task?: ModelTask; code: CapabilityValidationError }>;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const normalizeModelId = (value: string): string => value.trim();

export const isValidModelTokenLimit = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

export const modelConfigurationDefaultsFor = (
  manifest: ModelProtocolManifest | undefined,
  model: string | undefined,
  protocol?: string,
): ModelConfigurationDefaults | undefined => {
  const defaults = manifest?.model_defaults;
  return defaults && defaults.model.trim() === model?.trim() &&
    (protocol === undefined || defaults.protocol_id === protocol) ? defaults : undefined;
};

/** Drop only advisory values still owned by the previous exact model. */
export const removeModelConfigurationDefaults = (capability: ModelCapabilityDraft): ModelCapabilityDraft => {
  const previous = capability.modelDefaults;
  if (!previous) return capability;
  const { modelDefaults: _previousDefaults, ...next } = capability;
  if (previous.contextLimit !== undefined && next.contextLimitSource !== 'user' && next.contextLimit === previous.contextLimit) next.contextLimit = undefined;
  if (previous.outputLimit !== undefined && next.outputLimitSource !== 'user' && next.outputLimit === previous.outputLimit) next.outputLimit = undefined;
  if (Object.keys(previous.providerParams).length > 0) {
    const parsed = parseProviderParams(next.providerParamsJson);
    if (parsed.ok) {
      const params = { ...parsed.value };
      for (const [key, value] of Object.entries(previous.providerParams)) {
        if (JSON.stringify(params[key]) === JSON.stringify(value)) delete params[key];
      }
      next.providerParamsJson = Object.keys(params).length ? JSON.stringify(params, null, 2) : '';
    }
  }
  return next;
};

/** Protocol-specific suggestions expire on a protocol change; catalog token facts stay model-owned. */
const removeProtocolConfigurationDefaults = (capability: ModelCapabilityDraft): ModelCapabilityDraft => {
  const previous = capability.modelDefaults;
  if (!previous) return capability;
  const parsed = parseProviderParams(capability.providerParamsJson);
  if (!parsed.ok) return capability;
  const params = { ...parsed.value };
  const owned = { ...previous.providerParams };
  for (const [key, value] of Object.entries(owned)) {
    if (key === '_nomifun_context_limit_kind') continue;
    if (JSON.stringify(params[key]) === JSON.stringify(value)) delete params[key];
    delete owned[key];
  }
  return { ...capability, providerParamsJson: Object.keys(params).length ? JSON.stringify(params, null, 2) : '',
    modelDefaults: { ...previous, providerParams: owned } };
};

export const changeModelDefinitionId = (definition: ModelDefinitionDraft, model: string): ModelDefinitionDraft =>
  model.trim() === definition.model.trim() ? { ...definition, model } : {
    ...definition,
    model,
    displayName: undefined,
    capabilities: definition.capabilities.map(capability => {
      const next = removeModelConfigurationDefaults(capability);
      return capability.transportSource === 'auto'
        ? { ...resetCapabilityTransport(next, 'blank'), providerParamsSource: undefined }
        : next;
    }),
  };

export const reconcileModelConfigurationDefaults = (
  capabilities: readonly ModelCapabilityDraft[], manifests: ModelProtocolManifestMap, model: string,
): ModelCapabilityDraft[] => capabilities.map((capability) => {
  if (capability.transportSource === 'persisted') return capability;
  const defaults = modelConfigurationDefaultsFor(manifests[capability.task], model, capability.protocol);
  const base = capability.modelDefaults?.model !== model.trim() ? removeModelConfigurationDefaults(capability) : capability;
  if (!defaults || capability.transportSource === 'user') return base;
  const next = { ...base };
  const owned: NonNullable<ModelCapabilityDraft['modelDefaults']> = { model: model.trim(), providerParams: { ...base.modelDefaults?.providerParams } };
  if (base.modelDefaults?.contextLimit !== undefined) owned.contextLimit = base.modelDefaults.contextLimit;
  if (base.modelDefaults?.outputLimit !== undefined) owned.outputLimit = base.modelDefaults.outputLimit;
  if (next.contextLimit === undefined && next.contextLimitSource !== 'user' && isValidModelTokenLimit(defaults.context_limit)) {
    next.contextLimit = defaults.context_limit;
    owned.contextLimit = defaults.context_limit;
  }
  if (next.outputLimit === undefined && next.outputLimitSource !== 'user' && isValidModelTokenLimit(defaults.output_limit)) {
    next.outputLimit = defaults.output_limit;
    owned.outputLimit = defaults.output_limit;
  }
  const parsed = parseProviderParams(next.providerParamsJson);
  if (parsed.ok && next.providerParamsSource !== 'user') {
    const params = { ...parsed.value };
    const suggestions = { ...defaults.provider_params,
      ...(owned.contextLimit !== undefined && defaults.context_limit_kind ? { _nomifun_context_limit_kind: defaults.context_limit_kind } : {}) };
    for (const [key, value] of Object.entries(suggestions)) {
      if (!Object.prototype.hasOwnProperty.call(params, key)) { params[key] = value; owned.providerParams[key] = value; }
    }
    next.providerParamsJson = Object.keys(params).length ? JSON.stringify(params, null, 2) : '';
  }
  next.modelDefaults = owned;
  return JSON.stringify(capability) === JSON.stringify(next) ? capability : next;
});

export const emptyCapabilityDraft = (task: ModelTask): ModelCapabilityDraft => ({
  task,
  traits: [],
  transportSource: 'blank',
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
  outputLimit: undefined,
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
  output_limit?: number;
  compaction_threshold_pct?: number;
}): ModelCapabilityDraft => ({
  task: capability.task,
  traits: capability.traits ? [...capability.traits] : [],
  transportSource: 'persisted',
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
  outputLimit: capability.output_limit,
  compactionThresholdPct: capability.compaction_threshold_pct,
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
    'web_search',
  ],
  realtime_conversation: [],
  image_generation: [],
  image_edit: [],
  video_generation: [],
  speech_synthesis: [],
  speech_recognition: [],
  music_generation: [],
  embedding: [],
  rerank: [],
};

export const applyCatalogSuggestionForTask = (
  definition: ModelDefinitionDraft,
  suggestion: CatalogCapabilitySuggestion,
  task: ModelTask,
): ModelDefinitionDraft => {
  const declaresTask = suggestion.tasks.includes(task) &&
    (suggestion.tasksSource === 'provider_declared' || suggestion.tasksSource === 'official_documentation');
  const base = changeModelDefinitionId(definition, suggestion.model);
  const capabilities = addCapabilityTask(base.capabilities, task).map((capability) => {
    if (capability.task !== task || !declaresTask) return capability;
    const next = { ...capability, traits: MODEL_TRAIT_ORDER.filter((trait) =>
      suggestion.traits.includes(trait) && CATALOG_TRAITS_BY_TASK[task].includes(trait)) };
    const owned: NonNullable<ModelCapabilityDraft['modelDefaults']> = {
      model: suggestion.model.trim(), providerParams: { ...capability.modelDefaults?.providerParams },
      ...(capability.modelDefaults?.contextLimit === undefined ? {} : { contextLimit: capability.modelDefaults.contextLimit }),
      ...(capability.modelDefaults?.outputLimit === undefined ? {} : { outputLimit: capability.modelDefaults.outputLimit }),
    };
    if (capability.transportSource !== 'persisted') {
      if ((next.contextLimit === undefined || (owned.contextLimit !== undefined && next.contextLimit === owned.contextLimit)) && next.contextLimitSource !== 'user' && isValidModelTokenLimit(suggestion.contextLimit)) {
        next.contextLimit = suggestion.contextLimit;
        owned.contextLimit = suggestion.contextLimit;
        const params = parseProviderParams(next.providerParamsJson);
        if (suggestion.contextLimitKind && params.ok &&
          (!Object.prototype.hasOwnProperty.call(params.value, '_nomifun_context_limit_kind') ||
            (Object.prototype.hasOwnProperty.call(owned.providerParams, '_nomifun_context_limit_kind') &&
              JSON.stringify(owned.providerParams._nomifun_context_limit_kind) === JSON.stringify(params.value._nomifun_context_limit_kind)))) {
          next.providerParamsJson = JSON.stringify({ ...params.value, _nomifun_context_limit_kind: suggestion.contextLimitKind }, null, 2);
          owned.providerParams._nomifun_context_limit_kind = suggestion.contextLimitKind;
        }
      }
      if ((next.outputLimit === undefined || (owned.outputLimit !== undefined && next.outputLimit === owned.outputLimit)) && next.outputLimitSource !== 'user' && isValidModelTokenLimit(suggestion.outputLimit)) {
        next.outputLimit = suggestion.outputLimit;
        owned.outputLimit = suggestion.outputLimit;
      }
      next.modelDefaults = owned;
    }
    return next;
  });
  return { ...base, ...(suggestion.label && suggestion.label !== suggestion.model ? { displayName: suggestion.label } : {}), capabilities };
};

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
  if (nextProtocol === capability.protocol.trim()) {
    return capability.transportSource === 'recommendation' ||
      capability.transportSource === 'auto' ||
      capability.transportSource === 'blank'
      ? { ...capability, transportSource: 'user' }
      : capability;
  }
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
    ...removeProtocolConfigurationDefaults(capability),
    transportSource: 'user',
    protocol: nextProtocol,
    connectionRole,
    baseUrlOverride,
    endpoint: '',
    pollEndpoint: '',
    contentEndpoint: '',
    realtimeEndpoint: '',
    allowCrossOriginCredentials: false,
    providerParamsJson: removeProtocolConfigurationDefaults(capability).providerParamsJson,
  };
};

const resetCapabilityTransport = (
  capability: ModelCapabilityDraft,
  transportSource: ModelCapabilityDraft['transportSource'],
): ModelCapabilityDraft => ({
  ...capability,
  transportSource,
  protocol: '',
  connectionRole: 'default',
  baseUrlOverride: '',
  endpoint: '',
  pollEndpoint: '',
  contentEndpoint: '',
  realtimeEndpoint: '',
  allowCrossOriginCredentials: false,
  providerParamsJson: capability.providerParamsJson,
});

export const reconcileCapabilityRecommendations = (
  capabilities: readonly ModelCapabilityDraft[],
  manifests: ModelProtocolManifestMap,
): ModelCapabilityDraft[] =>
  capabilities.map((capability) => {
    const manifest = manifests[capability.task];
    if (!manifest) return capability;
    if (capability.transportSource === 'user' || capability.transportSource === 'persisted') {
      return capability;
    }
    // A probe result is more specific than the generic manifest
    // recommendation. Keep it until the user edits the transport or resets the
    // surrounding provider draft.
    if (capability.transportSource === 'auto') {
      return capability;
    }
    const recommendation = manifest.recommendation;
    if (!recommendation) {
      return capability.transportSource === 'recommendation'
        ? resetCapabilityTransport(capability, 'blank')
        : capability;
    }
    const protocol = recommendation.protocol_id.trim();
    const connectionRole = recommendation.connection_role || 'default';
    const baseUrlOverride =
      connectionRole === 'default' &&
      recommendation.base_url_override_required &&
      recommendation.default_base_url
        ? recommendation.default_base_url
        : '';
    const protocolChanged = capability.protocol.trim() !== protocol;
    const base = protocolChanged
      ? resetCapabilityTransport(removeProtocolConfigurationDefaults(capability), 'recommendation')
      : capability;
    const outputLimit = base.outputLimit;
    return protocol === base.protocol &&
      connectionRole === base.connectionRole &&
      baseUrlOverride === base.baseUrlOverride &&
      base.transportSource === 'recommendation' &&
      outputLimit === base.outputLimit
      ? base
      : {
          ...base,
          protocol,
          connectionRole,
          baseUrlOverride,
          transportSource: 'recommendation',
          ...(outputLimit === undefined ? {} : { outputLimit }),
        };
  });

const TRANSPORT_DRAFT_FIELDS = new Set<keyof ModelCapabilityDraft>([
  'protocol',
  'connectionRole',
  'baseUrlOverride',
  'endpoint',
  'pollEndpoint',
  'contentEndpoint',
  'realtimeEndpoint',
  'allowCrossOriginCredentials',
  'providerParamsJson',
]);

export type ModelCapabilityDraftPatch = Partial<
  Omit<ModelCapabilityDraft, 'task' | 'transportSource'>
>;

/** Apply an interactive edit without letting a later probe overwrite it. */
export const patchCapabilityDraft = (
  capability: ModelCapabilityDraft,
  patch: ModelCapabilityDraftPatch,
): ModelCapabilityDraft => {
  let modelDefaults = capability.modelDefaults;
  if (modelDefaults && Object.prototype.hasOwnProperty.call(patch, 'providerParamsJson')) {
    const parsed = parseProviderParams(patch.providerParamsJson ?? '');
    modelDefaults = { ...modelDefaults, providerParams: parsed.ok ? Object.fromEntries(
      Object.entries(modelDefaults.providerParams).filter(([key, value]) =>
        Object.prototype.hasOwnProperty.call(parsed.value, key) && JSON.stringify(parsed.value[key]) === JSON.stringify(value)),
    ) : {} };
  }
  return {
  ...capability,
  ...patch,
  ...(modelDefaults ? { modelDefaults } : {}),
  task: capability.task,
  ...(Object.prototype.hasOwnProperty.call(patch, 'contextLimit') ? { contextLimitSource: 'user' as const } : {}),
  ...(Object.prototype.hasOwnProperty.call(patch, 'outputLimit') ? { outputLimitSource: 'user' as const } : {}),
  ...(Object.prototype.hasOwnProperty.call(patch, 'providerParamsJson') ? { providerParamsSource: 'user' as const } : {}),
  ...(Object.keys(patch).some((key) =>
    TRANSPORT_DRAFT_FIELDS.has(key as keyof ModelCapabilityDraft),
  )
    ? { transportSource: 'user' as const }
    : {}),
  };
};

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

const isVersionSegment = (segment: string): boolean =>
  /^v\d[a-z0-9]*$/i.test(segment);

const pathSegments = (path: string): string[] =>
  path.split('/').filter((segment) => segment.length > 0);

const isAbsoluteUrl = (value: string): boolean => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

const rootPathSegments = (baseUrl: string): string[] | undefined => {
  try {
    return pathSegments(new URL(baseUrl.trim()).pathname);
  } catch {
    return undefined;
  }
};

/** Does any path segment of this root name an API version? */
export const rootDeclaresVersion = (baseUrl: string): boolean =>
  (rootPathSegments(baseUrl) ?? []).some(isVersionSegment);

/** Mirrors the desktop URL algebra's root convention. */
export const rootMatchesShape = (
  baseUrl: string,
  shape: EndpointRootShape,
): boolean =>
  shape === 'versioned_root'
    ? rootDeclaresVersion(baseUrl)
    : !rootDeclaresVersion(baseUrl);

/**
 * Join a connection root and an endpoint template while collapsing one
 * duplicated version seam. Absolute endpoint overrides remain verbatim.
 */
export const joinEndpointUrl = (baseUrl: string, endpoint: string): string => {
  const template = endpoint.trim();
  if (isAbsoluteUrl(template)) return template;

  const root = baseUrl.trim().replace(/\/+$/, '');
  const tailIndex = template.search(/[?#]/);
  const templatePath = tailIndex >= 0 ? template.slice(0, tailIndex) : template;
  const tail = tailIndex >= 0 ? template.slice(tailIndex) : '';
  const templateSegments = pathSegments(templatePath);
  const rootSegments = rootPathSegments(root) ?? [];

  let drop = 0;
  const max = Math.min(rootSegments.length, templateSegments.length);
  for (let take = max; take >= 1; take -= 1) {
    const rootTail = rootSegments.slice(rootSegments.length - take);
    const matches = rootTail.every(
      (segment, index) =>
        segment.toLowerCase() === templateSegments[index]?.toLowerCase(),
    );
    if (matches && rootTail.some(isVersionSegment)) {
      drop = take;
      break;
    }
  }

  const remaining = templateSegments.slice(drop);
  return remaining.length === 0
    ? `${root}${tail}`
    : `${root}/${remaining.join('/')}${tail}`;
};

/** Preview the exact endpoint URL the desktop runtime will resolve. */
export const resolvedCapabilityUrl = (
  capability: ModelCapabilityDraft,
  descriptor: {
    field: string;
    default_value: string;
  },
  manifest: ModelProtocolManifest | undefined,
  providerBaseUrl: string,
  connections: readonly ProviderConnectionDescriptor[] = [],
): string => {
  const base = effectiveBaseUrl(
    capability,
    manifest,
    providerBaseUrl,
    connections,
  );
  const template = endpointDescriptorValue(capability, descriptor);
  if (!base.trim() || !template.trim()) return '';
  return joinEndpointUrl(base, template);
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
    if ([capability.contextLimit, capability.outputLimit].some((value) => value !== undefined && !isValidModelTokenLimit(value))) {
      errors.push({ task: capability.task, code: 'invalid_token_limit' });
    }
    if (capability.compactionThresholdPct !== undefined &&
      (capability.task !== 'chat' || !Number.isInteger(capability.compactionThresholdPct) || capability.compactionThresholdPct < 50 || capability.compactionThresholdPct > 95)) {
      errors.push({ task: capability.task, code: 'invalid_compaction_threshold' });
    }
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
    if (
      descriptor?.requires_output_ceiling === true &&
      !(
        typeof capability.outputLimit === 'number' &&
        Number.isFinite(capability.outputLimit) &&
        capability.outputLimit > 0
      )
    ) {
      errors.push({ task: capability.task, code: 'output_ceiling_required' });
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
  if (capability.outputLimit !== undefined && capability.outputLimit > 0) {
    input.output_limit = capability.outputLimit;
  }
  if (capability.compactionThresholdPct !== undefined) input.compaction_threshold_pct = capability.compactionThresholdPct;
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
