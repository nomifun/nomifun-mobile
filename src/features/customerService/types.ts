/**
 * Wire types for the 客服 (customer-service) domain.
 *
 * This domain is deliberately separate from 桌面伙伴 (companion): its own
 * tables, its own bot pool, its own dialogues. A customer-service turn is
 * built with a fixed whitelist of three read-only tools (knowledge_search /
 * knowledge_read / cs_notes_search) — high-risk capabilities are never
 * registered. That guarantee is the product story, so the UI states it.
 *
 * Every id is a business UUIDv7 (`cs_agent_id`, `cs_note_id`, …). There is no
 * `id` field anywhere on the wire; see `normalizeCsAgent`.
 */

export type CsNoteKind = 'faq' | 'script' | 'fact';

export const CS_NOTE_KINDS: readonly CsNoteKind[] = ['faq', 'script', 'fact'];

/** A channel bot belongs to exactly one domain, forever (DB trigger enforced). */
export type ChannelOwnerDomain = 'companion' | 'customer_service';

/** One customer-service agent (客服员工). */
export interface CsAgent {
  cs_agent_id: string;
  name: string;
  /** 问候语 — opening line for a visitor. */
  greeting: string;
  /** 人设话术 — persona/voice guidance. */
  persona: string;
  /** 服务策略 — business scope / off-limits topics / compliance phrasing. */
  service_policy: string;
  provider_id: string | null;
  model: string | null;
  /** Knowledge bases this agent may retrieve from. */
  knowledge_base_ids: string[];
  enabled: boolean;
  /** Per-agent concurrent turn ceiling (1..=64). */
  max_concurrent: number;
  audit_retention_days: number;
  created_at: number;
  updated_at: number;
}

/**
 * Editable fields (PATCH is a partial merge).
 *
 * `provider_id` / `model` are double-Option on the server: absent = keep,
 * present-`null` = clear, present-value = set. Never build these bodies by
 * spreading a partial object with `undefined` values — use
 * `buildAgentPatchBody`.
 */
export interface CsAgentPatch {
  name?: string;
  greeting?: string;
  persona?: string;
  service_policy?: string;
  provider_id?: string | null;
  model?: string | null;
  knowledge_base_ids?: string[];
  enabled?: boolean;
  max_concurrent?: number;
  audit_retention_days?: number;
}

/** One bot ↔ agent binding (a bot serves at most one agent). */
export interface CsChannelBinding {
  cs_agent_id: string;
  channel_plugin_id: string;
  created_at: number;
}

/** One customer-service note. `cs_agent_id === null` = shared by every agent. */
export interface CsNote {
  cs_note_id: string;
  cs_agent_id: string | null;
  kind: string;
  content: string;
  enabled: boolean;
  created_at: number;
  updated_at: number;
}

/** One visitor dialogue lane — the (bot, visitor, chat) triple. */
export interface CsDialogue {
  cs_dialogue_id: string;
  cs_agent_id: string;
  channel_plugin_id: string;
  channel_user_id: string;
  chat_id: string;
  state: 'open' | 'closed';
  created_at: number;
  last_activity: number;
}

/** One transcript row. There is no human-operator role, by design. */
export interface CsMessage {
  cs_message_id: string;
  cs_dialogue_id: string;
  role: 'visitor' | 'agent' | 'system';
  content: string;
  created_at: number;
}

/** Subset of `/api/channel/plugins` this feature reads. */
export interface ChannelPluginStatus {
  plugin_id: string;
  type: string;
  name: string;
  enabled: boolean;
  connected: boolean;
  hasToken?: boolean;
  botUsername?: string;
  activeUsers?: number;
  owner_domain: ChannelOwnerDomain;
}

/** Subset of `/api/knowledge/bases`. */
export interface KnowledgeBaseSummary {
  knowledge_base_id: string;
  name: string;
  description: string;
  file_count: number;
}

/** Subset of `/api/providers`. */
export interface ProviderSummary {
  provider_id: string;
  name: string;
  platform: string;
  enabled: boolean;
}

/** One (provider, model) pair returned by `POST /api/model-profiles/resolve`. */
export interface CatalogModelRef {
  provider_id: string;
  model: string;
}

/** One provider's chat-capable models, in catalog order. */
export interface TaskModelGroup {
  provider: ProviderSummary;
  models: string[];
}
