/**
 * Typed endpoint functions for the customer-service domain.
 *
 * Every route lives behind `protect_instance_owner` and answers with the
 * standard `{success, data, message}` envelope, which `api()` unwraps.
 *
 * Contract notes that are easy to get wrong:
 * - PATCH agent: `provider_id` / `model` are double-Option (absent = keep,
 *   null = clear). Bodies come from `buildAgentPatchBody`, never from a spread.
 * - PUT bindings is a FULL-SET replacement and it *steals* a bot from another
 *   agent. Callers must send "currently bound ± one" (see `bindings.ts`), never
 *   a single id, or every other bot of the agent is silently unbound.
 * - Note *scope* (`cs_agent_id` null-or-not) has no PATCH path — immutable
 *   after creation.
 */
import { api } from '@/api/client';
import { orderSelectorProviders } from '@/features/models/selectors';

import {
  normalizeChannelPluginStatus,
  normalizeCsAgent,
  normalizeCsBinding,
  normalizeCsDialogue,
  normalizeCsMessage,
  normalizeCsNote,
  normalizeKnowledgeBase,
  normalizeProvider,
  buildAgentPatchBody,
} from './normalize';
import type {
  CatalogModelRef,
  ChannelPluginStatus,
  CsAgent,
  CsAgentPatch,
  CsChannelBinding,
  CsDialogue,
  CsMessage,
  CsNote,
  KnowledgeBaseSummary,
  ProviderSummary,
} from './types';

const asArray = (raw: unknown): unknown[] => (Array.isArray(raw) ? raw : []);

// ── agents ────────────────────────────────────────────────────────────

export async function listAgents(): Promise<CsAgent[]> {
  const rows = await api<unknown>('/api/customer-service/agents');
  return asArray(rows).map(normalizeCsAgent);
}

export async function getAgent(csAgentId: string): Promise<CsAgent> {
  const row = await api<unknown>(`/api/customer-service/agents/${csAgentId}`);
  return normalizeCsAgent(row);
}

/** Create an agent. Only `name` is required; the server defaults the rest. */
export async function createAgent(name: string): Promise<CsAgent> {
  const row = await api<unknown>('/api/customer-service/agents', { body: { name } });
  return normalizeCsAgent(row);
}

export async function patchAgent(csAgentId: string, patch: CsAgentPatch): Promise<CsAgent> {
  const row = await api<unknown>(`/api/customer-service/agents/${csAgentId}`, {
    method: 'PATCH',
    body: buildAgentPatchBody(patch),
  });
  return normalizeCsAgent(row);
}

/** Deletes the agent and cascades bindings, dialogues and private notes. */
export async function deleteAgent(csAgentId: string): Promise<void> {
  await api<unknown>(`/api/customer-service/agents/${csAgentId}`, { method: 'DELETE' });
}

// ── bindings ──────────────────────────────────────────────────────────

export async function listBindings(csAgentId: string): Promise<CsChannelBinding[]> {
  const rows = await api<unknown>(`/api/customer-service/agents/${csAgentId}/bindings`);
  return asArray(rows).map(normalizeCsBinding);
}

/**
 * Replace this agent's WHOLE binding set.
 *
 * The route validates every id first (unknown plugin → 400 `channel plugin
 * '…' not found`; companion-domain plugin → 400) and writes nothing when it
 * rejects. A listed bot owned by another customer-service agent is re-bound to
 * this one; `[]` unbinds everything. Build the argument with
 * `planBindingChange` so those semantics stay explicit at the call site.
 */
export async function replaceBindings(
  csAgentId: string,
  channelPluginIds: readonly string[],
): Promise<CsChannelBinding[]> {
  const rows = await api<unknown>(`/api/customer-service/agents/${csAgentId}/bindings`, {
    method: 'PUT',
    body: { channel_plugin_ids: [...channelPluginIds] },
  });
  return asArray(rows).map(normalizeCsBinding);
}

// ── notes ─────────────────────────────────────────────────────────────

/** Notes visible to one agent: its private notes plus every shared note. */
export async function listNotes(csAgentId: string): Promise<CsNote[]> {
  const rows = await api<unknown>(
    `/api/customer-service/notes?cs_agent_id=${encodeURIComponent(csAgentId)}`,
  );
  return asArray(rows).map(normalizeCsNote);
}

export async function createNote(input: {
  /** `null` = shared across every agent (create-only decision). */
  cs_agent_id: string | null;
  kind: string;
  content: string;
  enabled: boolean;
}): Promise<CsNote> {
  const row = await api<unknown>('/api/customer-service/notes', {
    body: {
      cs_agent_id: input.cs_agent_id,
      kind: input.kind,
      content: input.content,
      enabled: input.enabled,
    },
  });
  return normalizeCsNote(row);
}

export async function patchNote(
  csNoteId: string,
  patch: { kind?: string; content?: string; enabled?: boolean },
): Promise<CsNote> {
  const body: Record<string, unknown> = {};
  if (patch.kind !== undefined) body.kind = patch.kind;
  if (patch.content !== undefined) body.content = patch.content;
  if (patch.enabled !== undefined) body.enabled = patch.enabled;
  const row = await api<unknown>(`/api/customer-service/notes/${csNoteId}`, {
    method: 'PATCH',
    body,
  });
  return normalizeCsNote(row);
}

export async function deleteNote(csNoteId: string): Promise<void> {
  await api<unknown>(`/api/customer-service/notes/${csNoteId}`, { method: 'DELETE' });
}

// ── dialogues (monitoring; no WS events exist — poll on demand) ────────

/** Visitor lanes of one agent, newest activity first. */
export async function listDialogues(csAgentId: string): Promise<CsDialogue[]> {
  const rows = await api<unknown>(
    `/api/customer-service/dialogues?cs_agent_id=${encodeURIComponent(csAgentId)}`,
  );
  return asArray(rows).map(normalizeCsDialogue);
}

/** Full transcript of one dialogue, chronological. */
export async function listDialogueMessages(csDialogueId: string): Promise<CsMessage[]> {
  const rows = await api<unknown>(
    `/api/customer-service/dialogues/${csDialogueId}/messages`,
  );
  return asArray(rows).map(normalizeCsMessage);
}

// ── shared surfaces the feature consumes ──────────────────────────────

export async function listKnowledgeBases(): Promise<KnowledgeBaseSummary[]> {
  const rows = await api<unknown>('/api/knowledge/bases');
  return asArray(rows).map(normalizeKnowledgeBase);
}

export async function listProviders(): Promise<ProviderSummary[]> {
  const rows = await api<unknown>('/api/providers');
  return orderSelectorProviders(
    asArray(rows)
    .map(normalizeProvider)
    .filter((provider) => provider.enabled),
  );
}

/** Authoritative chat-capable (provider, model) catalog. */
export async function resolveChatModels(): Promise<CatalogModelRef[]> {
  const providers = await listProviders();
  return providers.flatMap((provider) =>
    (provider.models ?? [])
      .filter(
        (model) =>
          model.enabled === true &&
          model.capabilities.some((capability) => capability.task === 'chat'),
      )
      .map((model) => ({
        provider_id: provider.provider_id,
        model: model.model,
      })),
  );
}

/** All channel bots; the CS pool is filtered client-side by owner_domain. */
export async function listChannelPlugins(): Promise<ChannelPluginStatus[]> {
  const rows = await api<unknown>('/api/channel/plugins');
  return asArray(rows).map(normalizeChannelPluginStatus);
}
