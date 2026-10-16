import type {
  ModelRef,
  ModelTask,
  ModelTrait,
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
 * A model name is not a capability.  Runtime selection must match the task
 * and every requested trait on the same nested capability object.
 */
export function modelSupportsTask(
  model: ProviderResponse['models'][number],
  task: ModelTask,
  requiredTraits: readonly ModelTrait[] = [],
): boolean {
  const capability = model.capabilities.find((item) => item.task === task);
  return Boolean(
    capability &&
      requiredTraits.every((trait) => (capability.traits ?? []).includes(trait)),
  );
}

/** Check a persisted reference against the currently runnable provider graph. */
export function isUsableModelRef(
  providers: readonly ProviderResponse[],
  ref: ModelRef | undefined,
  task: ModelTask,
  requiredTraits: readonly ModelTrait[] = [],
): ref is ModelRef {
  if (!ref?.provider_id || !ref.model) return false;
  const provider = providers.find((item) => item.provider_id === ref.provider_id);
  if (!provider || provider.enabled === false) return false;
  const model = provider.models.find((item) => item.model === ref.model);
  return !!model && model.enabled === true && modelSupportsTask(model, task, requiredTraits);
}

/** Pick the first runnable model in provider/model API order. */
export function firstUsableModel(
  providers: readonly ProviderResponse[],
  task: ModelTask,
  requiredTraits: readonly ModelTrait[] = [],
): ModelRef | undefined {
  for (const provider of orderSelectorProviders(providers)) {
    if (provider.enabled === false) continue;
    const model = provider.models.find(
      (item) => item.enabled === true && modelSupportsTask(item, task, requiredTraits),
    );
    if (model) {
      return { provider_id: provider.provider_id, model: model.model };
    }
  }
  return undefined;
}

/** Flatten the runnable graph while preserving provider/model response order. */
export function usableModelRefs(
  providers: readonly ProviderResponse[],
  task: ModelTask,
  requiredTraits: readonly ModelTrait[] = [],
): ModelRef[] {
  const refs: ModelRef[] = [];
  for (const provider of orderSelectorProviders(providers)) {
    if (provider.enabled === false) continue;
    for (const model of provider.models) {
      if (model.enabled !== true || !modelSupportsTask(model, task, requiredTraits)) continue;
      refs.push({ provider_id: provider.provider_id, model: model.model });
    }
  }
  return refs;
}
