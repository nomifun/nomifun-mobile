import type { ModelRef } from './types';

/** A friendly label never replaces the upstream model id in a command. */
export const modelDisplayLabel = (model: string, displayName?: string): string =>
  displayName?.trim() || model;

export const modelPresentationRawId = (model: string, displayName?: string): string | undefined =>
  displayName?.trim() && displayName.trim() !== model ? model : undefined;

type ProviderLabels = readonly {
  provider_id: string;
  name?: string;
  models?: readonly { model: string; display_name?: string }[];
}[];

export function modelRefLabel(
  providers: ProviderLabels | undefined,
  ref: Partial<ModelRef> | null | undefined,
): string | undefined {
  if (!ref?.model) return undefined;
  const provider = providers?.find((item) => item.provider_id === ref.provider_id);
  const row = provider?.models?.find((item) => item.model === ref.model);
  return modelDisplayLabel(ref.model, row?.display_name);
}

export function providerModelRefLabel(
  providers: ProviderLabels | undefined,
  ref: Partial<ModelRef> | null | undefined,
): string | undefined {
  const label = modelRefLabel(providers, ref);
  if (!label) return undefined;
  const provider = providers?.find((item) => item.provider_id === ref?.provider_id);
  const name = provider?.name?.trim() || ref?.provider_id;
  return name ? `${name} · ${label}` : label;
}
