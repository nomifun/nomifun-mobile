/**
 * Per-conversation model switching.
 *
 * `PATCH /api/conversations/:id` takes a `ProviderWithModel`
 * (`{provider_id, model, use_model?}`, `deny_unknown_fields`), so the body is
 * exactly `{model: {provider_id, model}}`. Only `type: 'nomi'` rows switch this
 * way — ACP sessions use `PUT .../model` and a mode concept the phone does not
 * implement, so the picker hides itself for them.
 *
 * Candidates come from the same canonical nested provider catalog used by the
 * model-management screen, filtered to enabled chat capabilities. A model the
 * catalog no longer returns is still shown when it is the current one, so a
 * stale binding stays visible instead of silently reading as "no model".
 */
import { isManagedProvider } from '@/features/models/platforms';

import type { Conversation, WireModel } from './api';

export interface ModelOption {
  providerId: string;
  providerName: string;
  /** Managed providers (NomiFun free models) are labelled and never editable upstream. */
  managed: boolean;
  model: string;
}

export interface ModelGroup {
  providerId: string;
  providerName: string;
  managed: boolean;
  models: string[];
}

/** Only nomi rows accept `{model}`; everything else hides the affordance. */
export function supportsModelSwitch(conversation: Conversation | undefined): boolean {
  return conversation?.type === 'nomi';
}

export function currentModelRef(conversation: Conversation | undefined): WireModel | undefined {
  const model = conversation?.model;
  if (!model || typeof model !== 'object') return undefined;
  if (typeof model.provider_id !== 'string' || typeof model.model !== 'string') return undefined;
  if (!model.provider_id || !model.model) return undefined;
  return model;
}

/** Label for the chip: the bare model name, which is what users recognise. */
export function modelLabel(conversation: Conversation | undefined): string | undefined {
  return currentModelRef(conversation)?.model;
}

export function isSameModel(a: WireModel | undefined, b: { providerId: string; model: string }) {
  return a?.provider_id === b.providerId && a?.model === b.model;
}

/**
 * Group the catalog's flat candidate list by provider, in provider order, and
 * make sure the conversation's current model is present even when the catalog
 * dropped it (disabled row, deleted model, provider re-keyed).
 */
export function buildModelGroups(
  candidates: readonly { provider_id?: string; model?: string }[] | undefined,
  providers: readonly { provider_id: string; name?: string; platform?: string }[] | undefined,
  current?: WireModel,
): ModelGroup[] {
  const byProvider = new Map<string, string[]>();
  const push = (providerId: string, model: string) => {
    const list = byProvider.get(providerId);
    if (!list) byProvider.set(providerId, [model]);
    else if (!list.includes(model)) list.push(model);
  };

  for (const ref of candidates ?? []) {
    if (typeof ref?.provider_id !== 'string' || typeof ref?.model !== 'string') continue;
    if (!ref.provider_id || !ref.model) continue;
    push(ref.provider_id, ref.model);
  }
  if (current) push(current.provider_id!, current.model!);

  const groups: ModelGroup[] = [];
  const seen = new Set<string>();
  for (const provider of providers ?? []) {
    const models = byProvider.get(provider.provider_id);
    if (!models || models.length === 0) continue;
    seen.add(provider.provider_id);
    groups.push({
      providerId: provider.provider_id,
      providerName: provider.name?.trim() || provider.provider_id,
      managed: isManagedProvider(provider.platform ?? ''),
      models,
    });
  }
  // A provider the list call did not return (deleted, or not yet loaded) still
  // gets a group so its models remain selectable.
  for (const [providerId, models] of byProvider) {
    if (seen.has(providerId)) continue;
    groups.push({ providerId, providerName: providerId, managed: false, models });
  }
  return groups;
}
