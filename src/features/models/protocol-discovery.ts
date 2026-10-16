/** Exact setup-time discovery state. Runtime routing and protocol conversion stay on the server. */
import { capabilityDraftFromResponse, capabilityInputFromDraft, parseProviderParams, type ModelCapabilityDraft, type ModelDefinitionDraft } from './advanced';
import type { BedrockConfig, ProviderConnectionInput, ProviderCredentials, ProviderModelCapabilityInput } from './types';

export interface ModelProtocolDiscoveryContext {
  /** Local configuration observation; never included in request DTOs. */
  configurationRevision?: string;
  providerId?: string;
  platform: string;
  baseUrl: string;
  authScheme: string;
  credentials?: ProviderCredentials;
  connections?: ProviderConnectionInput[];
  bedrockConfig?: BedrockConfig;
}

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]),
  );
  return value;
};

export const discoveryAppliesDefaults = (capability: ModelCapabilityDraft): boolean =>
  capability.providerParamsSource !== 'user' && capability.transportSource !== 'persisted';

export const discoverySnapshot = (model: string, capability: ModelCapabilityDraft): string =>
  JSON.stringify(stableValue({ model: model.trim(), capability: capabilityInputFromDraft(capability),
    apply_recommended_defaults: discoveryAppliesDefaults(capability) }));

/** Local only: this snapshot can include secrets and must never be a cache key. */
export const discoveryContextSnapshot = (context: ModelProtocolDiscoveryContext): string =>
  JSON.stringify(stableValue(context));

export const applyDiscoveredCapability = (
  definition: ModelDefinitionDraft, snapshot: string, selected: ProviderModelCapabilityInput,
  selectionSource: 'automatic' | 'manual' = 'automatic',
): ModelDefinitionDraft => {
  const current = definition.capabilities.find((capability) => capability.task === selected.task);
  if (!current || discoverySnapshot(definition.model, current) !== snapshot) return definition;
  const tested = capabilityDraftFromResponse(selected);
  const automatic = selectionSource === 'automatic' && discoveryAppliesDefaults(current) && ['blank', 'recommendation', 'auto'].includes(current.transportSource);
  const previous = parseProviderParams(current.providerParamsJson);
  const after = parseProviderParams(tested.providerParamsJson);
  const ownedParams = previous.ok && after.ok ? Object.fromEntries(Object.entries(after.value).filter(([key, value]) =>
    (automatic && !Object.prototype.hasOwnProperty.call(previous.value, key)) ||
    (Object.prototype.hasOwnProperty.call(current.modelDefaults?.providerParams ?? {}, key) &&
      JSON.stringify(current.modelDefaults?.providerParams[key]) === JSON.stringify(value)))) : {};
  const modelDefaults = current.modelDefaults || automatic ? {
    ...current.modelDefaults, model: definition.model.trim(), providerParams: ownedParams,
  } : undefined;
  return { ...definition, capabilities: definition.capabilities.map((capability) =>
    capability.task === selected.task ? { ...tested, transportSource: automatic ? 'auto' : current.transportSource === 'persisted' ? 'persisted' : 'user',
      contextLimitSource: capability.contextLimitSource, outputLimitSource: capability.outputLimitSource,
      providerParamsSource: capability.providerParamsSource, ...(modelDefaults ? { modelDefaults } : {}) } : capability) };
};
