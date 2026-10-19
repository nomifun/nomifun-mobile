import type {
  ModelRef,
  ModelTask,
  ModelTrait,
  ModelTechnicalCapability,
  ProviderModelCapabilityResponse,
  ProviderResponse,
} from './types';
import { isManagedProvider } from './platforms';

/** Desktop runtime selector ordering: managed free models last, stable API order otherwise. */
export function orderSelectorProviders<T extends { platform?: string }>(
  providers: readonly T[],
): T[] {
  return providers
    .map((provider, index) => ({ provider, index }))
    .sort((left, right) => {
      const rank =
        Number(isManagedProvider(left.provider.platform ?? '')) -
        Number(isManagedProvider(right.provider.platform ?? ''));
      return rank || left.index - right.index;
    })
    .map(({ provider }) => provider);
}

/**
 * Return whether a model row is runnable for one exact capability request.
 *
 * Input support follows the configured Chat adapter, just as in desktop's
 * providerModels helper. Catalog traits describe the model; missing catalog
 * metadata must not hide an adapter that can encode the requested input.
 */
export function capabilitySupportsTrait(
  capability: ProviderModelCapabilityResponse | undefined,
  trait: ModelTrait,
): boolean {
  if (capability?.task !== 'chat') return false;
  switch (trait) {
    case 'vision_input':
      return ['openai.chat_text', 'openai.responses', 'anthropic.messages',
        'gemini.generate_text', 'bedrock.anthropic_messages',
        'vertex.anthropic_messages'].includes(capability.protocol);
    case 'audio_input':
      return ['openai.chat_text', 'openai.responses', 'gemini.generate_text'].includes(capability.protocol);
    case 'web_search':
      return capability.protocol === 'openai.responses';
    case 'video_input':
      return false;
  }
}

export function modelSupportsTask(
  model: ProviderResponse['models'][number],
  task: ModelTask,
  requiredTraits: readonly ModelTrait[] = [],
  requiredTechnicalCapabilities: readonly ModelTechnicalCapability[] = [],
): boolean {
  const capability = model.capabilities.find((item) => item.task === task);
  return Boolean(
    capability &&
      requiredTraits.every((trait) => capabilitySupportsTrait(capability, trait)) &&
      requiredTechnicalCapabilities.every(
        (technical) => !capability.health?.unsupported_technical_capabilities?.includes(technical),
      ),
  );
}

/** Check a persisted reference against the currently runnable provider graph. */
export function isUsableModelRef(
  providers: readonly ProviderResponse[],
  ref: ModelRef | undefined,
  task: ModelTask,
  requiredTraits: readonly ModelTrait[] = [],
  requiredTechnicalCapabilities: readonly ModelTechnicalCapability[] = [],
): ref is ModelRef {
  if (!ref?.provider_id || !ref.model) return false;
  const provider = providers.find((item) => item.provider_id === ref.provider_id);
  if (!provider || provider.enabled === false) return false;
  const model = provider.models.find((item) => item.model === ref.model);
  return !!model && model.enabled === true && modelSupportsTask(model, task, requiredTraits, requiredTechnicalCapabilities);
}

/** Flatten the runnable graph while preserving provider/model response order. */
export function usableModelRefs(
  providers: readonly ProviderResponse[],
  task: ModelTask,
  requiredTraits: readonly ModelTrait[] = [],
  requiredTechnicalCapabilities: readonly ModelTechnicalCapability[] = [],
): ModelRef[] {
  const refs: ModelRef[] = [];
  for (const provider of orderSelectorProviders(providers)) {
    if (provider.enabled === false) continue;
    for (const model of provider.models) {
      if (model.enabled !== true || !modelSupportsTask(model, task, requiredTraits, requiredTechnicalCapabilities)) continue;
      refs.push({ provider_id: provider.provider_id, model: model.model });
    }
  }
  return refs;
}
