/**
 * Pure normalizers + selectors for the customer-service domain.
 *
 * Ported from the desktop (`pages/customerService/csChannelBots.ts` and the
 * `fromApiCs*` helpers in `ipcBridge.ts`). The two defences worth keeping:
 *
 * 1. `knowledge_base_ids` is stored as a JSON-array *string* and may arrive as
 *    either that string or a real array.
 * 2. The wire payload must never carry an `id` field — business UUIDv7 ids
 *    only. A payload with `id` means we are talking to the wrong contract, so
 *    we throw instead of silently rendering a row we cannot address.
 *
 * No React, no I/O — everything here is unit-testable in isolation.
 */
import type {
  ChannelOwnerDomain,
  ChannelPluginStatus,
  CatalogModelRef,
  CsAgent,
  CsAgentPatch,
  CsChannelBinding,
  CsDialogue,
  CsMessage,
  CsNote,
  CsNoteKind,
  KnowledgeBaseSummary,
  ProviderSummary,
  TaskModelGroup,
} from './types';

export const DEFAULT_MAX_CONCURRENT = 8;
export const MIN_MAX_CONCURRENT = 1;
export const MAX_MAX_CONCURRENT = 64;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function asWireObject(raw: unknown, what: string): Record<string, unknown> {
  if (!isRecord(raw)) throw new TypeError(`${what} wire payload must be an object`);
  return raw;
}

function requireId(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new TypeError(`customer-service wire payload is missing ${field}`);
  }
  return raw;
}

const asText = (raw: unknown): string => (typeof raw === 'string' ? raw : '');

const asNullableText = (raw: unknown): string | null =>
  typeof raw === 'string' && raw.length > 0 ? raw : null;

const asBool = (raw: unknown, fallback: boolean): boolean =>
  typeof raw === 'boolean' ? raw : fallback;

const asInt = (raw: unknown, fallback: number): number =>
  typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : fallback;

/**
 * `knowledge_base_ids` normalizer: accepts a real array or the stored
 * JSON-array string. A corrupt string yields `[]` rather than throwing — one
 * bad row must not take down the whole roster.
 */
export function normalizeKnowledgeBaseIds(raw: unknown): string[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'string' && raw.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  return list.filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/** Clamp a concurrency ceiling into the server-validated 1..=64 range. */
export function clampMaxConcurrent(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_CONCURRENT;
  return Math.min(MAX_MAX_CONCURRENT, Math.max(MIN_MAX_CONCURRENT, Math.round(value)));
}

export function normalizeCsAgent(raw: unknown): CsAgent {
  const agent = asWireObject(raw, 'customer-service agent');
  if (Object.prototype.hasOwnProperty.call(agent, 'id')) {
    throw new TypeError('customer-service agent wire payload must use cs_agent_id, not id');
  }
  return {
    cs_agent_id: requireId(agent.cs_agent_id, 'cs_agent_id'),
    name: asText(agent.name),
    greeting: asText(agent.greeting),
    persona: asText(agent.persona),
    service_policy: asText(agent.service_policy),
    provider_id: asNullableText(agent.provider_id),
    model: asNullableText(agent.model),
    knowledge_base_ids: normalizeKnowledgeBaseIds(agent.knowledge_base_ids),
    enabled: asBool(agent.enabled, true),
    max_concurrent: clampMaxConcurrent(asInt(agent.max_concurrent, DEFAULT_MAX_CONCURRENT)),
    audit_retention_days: asInt(agent.audit_retention_days, 30),
    created_at: asInt(agent.created_at, 0),
    updated_at: asInt(agent.updated_at, 0),
  };
}

export function normalizeCsNote(raw: unknown): CsNote {
  const note = asWireObject(raw, 'customer-service note');
  if (Object.prototype.hasOwnProperty.call(note, 'id')) {
    throw new TypeError('customer-service note wire payload must use cs_note_id, not id');
  }
  return {
    cs_note_id: requireId(note.cs_note_id, 'cs_note_id'),
    cs_agent_id: asNullableText(note.cs_agent_id),
    kind: asText(note.kind) || 'faq',
    content: asText(note.content),
    enabled: asBool(note.enabled, true),
    created_at: asInt(note.created_at, 0),
    updated_at: asInt(note.updated_at, 0),
  };
}

export function normalizeCsBinding(raw: unknown): CsChannelBinding {
  const binding = asWireObject(raw, 'customer-service binding');
  return {
    cs_agent_id: requireId(binding.cs_agent_id, 'cs_agent_id'),
    channel_plugin_id: requireId(binding.channel_plugin_id, 'channel_plugin_id'),
    created_at: asInt(binding.created_at, 0),
  };
}

export function normalizeCsDialogue(raw: unknown): CsDialogue {
  const dialogue = asWireObject(raw, 'customer-service dialogue');
  return {
    cs_dialogue_id: requireId(dialogue.cs_dialogue_id, 'cs_dialogue_id'),
    cs_agent_id: requireId(dialogue.cs_agent_id, 'cs_agent_id'),
    channel_plugin_id: asText(dialogue.channel_plugin_id),
    channel_user_id: asText(dialogue.channel_user_id),
    chat_id: asText(dialogue.chat_id),
    state: dialogue.state === 'closed' ? 'closed' : 'open',
    created_at: asInt(dialogue.created_at, 0),
    last_activity: asInt(dialogue.last_activity, 0),
  };
}

export function normalizeCsMessage(raw: unknown): CsMessage {
  const message = asWireObject(raw, 'customer-service message');
  const role = message.role;
  return {
    cs_message_id: requireId(message.cs_message_id, 'cs_message_id'),
    cs_dialogue_id: asText(message.cs_dialogue_id),
    role: role === 'agent' || role === 'system' ? role : 'visitor',
    content: asText(message.content),
    created_at: asInt(message.created_at, 0),
  };
}

export function normalizeChannelPluginStatus(raw: unknown): ChannelPluginStatus {
  const status = asWireObject(raw, 'channel plugin status');
  // The channel surface is snake_case on the wire; the desktop adapter also
  // exposes a few camelCase aliases, so accept both.
  const pluginId = status.plugin_id ?? status.pluginId;
  const hasToken = status.has_token ?? status.hasToken;
  const botUsername = status.bot_username ?? status.botUsername;
  const activeUsers = status.active_users ?? status.activeUsers;
  return {
    plugin_id: requireId(pluginId, 'plugin_id'),
    type: asText(status.type),
    name: asText(status.name),
    enabled: asBool(status.enabled, false),
    connected: asBool(status.connected, false),
    hasToken: typeof hasToken === 'boolean' ? hasToken : undefined,
    botUsername: asNullableText(botUsername) ?? undefined,
    activeUsers: asInt(activeUsers, 0),
    // Runtime lifecycle phase (`created`…`running`, `error`). Kept as a plain
    // string: the mobile UI only distinguishes `error`, and a server that grows
    // a new phase must not break normalization here.
    status: asNullableText(status.status) ?? undefined,
    // Transitional: a server that does not report the domain means 'companion'
    // (matches the DB `DEFAULT 'companion'`).
    owner_domain: status.owner_domain === 'customer_service' ? 'customer_service' : 'companion',
  };
}

export function normalizeKnowledgeBase(raw: unknown): KnowledgeBaseSummary {
  const base = asWireObject(raw, 'knowledge base');
  return {
    knowledge_base_id: requireId(base.knowledge_base_id, 'knowledge_base_id'),
    name: asText(base.name),
    description: asText(base.description),
    file_count: asInt(base.file_count, 0),
  };
}

export function normalizeProvider(raw: unknown): ProviderSummary {
  const provider = asWireObject(raw, 'provider');
  return {
    provider_id: requireId(provider.provider_id, 'provider_id'),
    name: asText(provider.name),
    platform: asText(provider.platform),
    enabled: asBool(provider.enabled, true),
  };
}

/**
 * Build a PATCH body from an intent object: `undefined` keys are dropped
 * (absent = keep), `null` keys survive (present-null = clear). Explicit, so
 * the double-Option contract can never be lost to a stray spread.
 */
export function buildAgentPatchBody(patch: CsAgentPatch): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.greeting !== undefined) body.greeting = patch.greeting;
  if (patch.persona !== undefined) body.persona = patch.persona;
  if (patch.service_policy !== undefined) body.service_policy = patch.service_policy;
  if (patch.provider_id !== undefined) body.provider_id = patch.provider_id;
  if (patch.model !== undefined) body.model = patch.model;
  if (patch.knowledge_base_ids !== undefined) body.knowledge_base_ids = patch.knowledge_base_ids;
  if (patch.enabled !== undefined) body.enabled = patch.enabled;
  if (patch.max_concurrent !== undefined) body.max_concurrent = clampMaxConcurrent(patch.max_concurrent);
  if (patch.audit_retention_days !== undefined) {
    body.audit_retention_days = patch.audit_retention_days;
  }
  return body;
}

/** Local merge used by the optimistic patch path (mirrors the server merge). */
export function mergeAgent(agent: CsAgent, patch: CsAgentPatch): CsAgent {
  return {
    ...agent,
    ...(patch.name !== undefined ? { name: patch.name } : null),
    ...(patch.greeting !== undefined ? { greeting: patch.greeting } : null),
    ...(patch.persona !== undefined ? { persona: patch.persona } : null),
    ...(patch.service_policy !== undefined ? { service_policy: patch.service_policy } : null),
    ...(patch.provider_id !== undefined ? { provider_id: patch.provider_id } : null),
    ...(patch.model !== undefined ? { model: patch.model } : null),
    ...(patch.knowledge_base_ids !== undefined
      ? { knowledge_base_ids: patch.knowledge_base_ids }
      : null),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : null),
    ...(patch.max_concurrent !== undefined
      ? { max_concurrent: clampMaxConcurrent(patch.max_concurrent) }
      : null),
    ...(patch.audit_retention_days !== undefined
      ? { audit_retention_days: patch.audit_retention_days }
      : null),
  };
}

/** Owner-domain check (a missing domain means the legacy companion default). */
export function statusInOwnerDomain(
  status: ChannelPluginStatus,
  domain: ChannelOwnerDomain,
): boolean {
  return (status.owner_domain ?? 'companion') === domain;
}

/** 客服域机器人挑选池 — companion bots never enter it. */
export function selectCsChannelBots(
  statuses: readonly ChannelPluginStatus[],
): ChannelPluginStatus[] {
  return statuses.filter((status) => statusInOwnerDomain(status, 'customer_service'));
}

export type CsBotBindingState =
  | { kind: 'boundToThis' }
  | { kind: 'boundToOther'; csAgentId: string }
  | { kind: 'unbound' };

/** 绑定态：绑本客服 / 绑其他客服（同域可换绑）/ 未绑定。 */
export function csBotBindingState(
  pluginId: string,
  csAgentId: string,
  ownerByBot: ReadonlyMap<string, string>,
): CsBotBindingState {
  const owner = ownerByBot.get(pluginId);
  if (owner == null) return { kind: 'unbound' };
  if (owner === csAgentId) return { kind: 'boundToThis' };
  return { kind: 'boundToOther', csAgentId: owner };
}

export type BotStatusKey = 'noToken' | 'disabled' | 'error' | 'connected' | 'connecting';

/**
 * Connection state of one bot, derived from hasToken / enabled / status /
 * connected.
 *
 * `status === 'error'` has to be its own key: the runtime parks a bot there when
 * the handshake failed for good (a revoked or mistyped token makes Telegram's
 * `getMe` answer 401), and `connected` stays false forever after. Folding that
 * into `connecting` would promise a connection that is never coming, which is
 * exactly the case a phone user needs to see. `noToken` and `disabled` still win
 * — both are more actionable, and a disabled bot's stored `error` is stale.
 */
export function botStatusKey(status: ChannelPluginStatus): BotStatusKey {
  if (status.hasToken === false) return 'noToken';
  if (!status.enabled) return 'disabled';
  if (status.connected) return 'connected';
  return status.status === 'error' ? 'error' : 'connecting';
}

/**
 * Group resolved (provider, model) refs by provider, preserving the provider
 * ordering of `providers` and the catalog ordering of each provider's models.
 * Refs whose provider is unknown (deleted provider metadata) are dropped.
 */
export function buildTaskModelGroups(
  refs: readonly CatalogModelRef[],
  providers: readonly ProviderSummary[],
): TaskModelGroup[] {
  const modelsByProvider = new Map<string, string[]>();
  for (const ref of refs) {
    if (!ref || typeof ref.provider_id !== 'string' || typeof ref.model !== 'string') continue;
    const models = modelsByProvider.get(ref.provider_id);
    if (!models) modelsByProvider.set(ref.provider_id, [ref.model]);
    else if (!models.includes(ref.model)) models.push(ref.model);
  }
  const groups: TaskModelGroup[] = [];
  for (const provider of providers) {
    const models = modelsByProvider.get(provider.provider_id);
    if (models && models.length > 0) groups.push({ provider, models });
  }
  return groups;
}

/** Note kind coerced into the three known values (server default is `faq`). */
export function asNoteKind(raw: string): CsNoteKind {
  return raw === 'script' || raw === 'fact' ? raw : 'faq';
}

/** Server timestamps are epoch millis; tolerate seconds just in case. */
export function toMillis(timestamp: number): number {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;
  return timestamp < 1e12 ? timestamp * 1000 : timestamp;
}

/** Short, stable label for a visitor lane (`channel_user_id` is a UUID). */
export function dialogueVisitorLabel(dialogue: CsDialogue): string {
  const source = dialogue.channel_user_id || dialogue.chat_id || dialogue.cs_dialogue_id;
  const tail = source.replace(/-/g, '').slice(-6).toUpperCase();
  return tail.length > 0 ? tail : '——';
}
