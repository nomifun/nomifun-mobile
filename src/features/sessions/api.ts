/**
 * AgentSession (会话) HTTP surface — the canonical session API.
 *
 * The desktop retired `/api/conversations/*` during the nomi-core refactor;
 * every row the phone renders is a `ConversationResponse` projected from an
 * AgentSession (`GET /api/agent-sessions/{id}/projection`). Two rules bite
 * here and are worth restating:
 *
 * - Rows still carry `conversation_id` / `message_id`, never `id`.
 * - Request bodies are `deny_unknown_fields` on the Rust side, so every
 *   builder below sends *exactly* the documented keys (`undefined` values are
 *   dropped by JSON.stringify).
 */
import { api } from '@/api/client';
import { listProviders } from '@/features/models/api';
import {
  firstUsableModel,
  isUsableModelRef,
} from '@/features/models/selectors';
import type { ModelRef } from '@/features/models/types';
import i18n from '@/i18n';
import {
  resolveRequiredResourceSelections,
  type AgentResourceSelection,
} from './resource-selections';

// ── Session row (ConversationResponse projection) ────────────────

/** `{provider_id, model, use_model?}` — the nomi model reference on a row. */
export interface WireModel {
  provider_id?: string;
  model?: string;
  use_model?: string;
}

export interface ConversationRuntime {
  state?: 'idle' | 'starting' | 'running' | string;
  can_send_message?: boolean;
  has_runtime?: boolean;
  runtime_status?: string;
  is_processing?: boolean;
  active_turn_id?: string;
  processing_started_at?: number;
}

export interface ConversationExtra {
  /** A companion's single per-companion session (desktop 单会话契约). */
  companion_session?: boolean | number;
  companion_id?: string;
  summon?: { companion_id?: string; summoned_at?: number };
  channel_platform?: string;
  /**
   * Absolute agent cwd on the desktop machine — frozen at create time as the
   * session's Workspace resource binding.
   */
  workspace?: string;
  /**
   * Response-only, re-derived by the server on every read (`workspace` sits
   * under its data dir ⇒ auto-provisioned temp workspace). Never send it.
   */
  is_temporary_workspace?: boolean;
  [key: string]: unknown;
}

export interface Conversation {
  conversation_id: string;
  name: string;
  type: string;
  model?: WireModel | null;
  status?: 'pending' | 'running' | 'finished' | string;
  runtime?: ConversationRuntime | null;
  source?: string;
  pinned?: boolean;
  pinned_at?: number;
  /** Frozen preset lineage — read-only display metadata. */
  preset_id?: string;
  agent_snapshot?: { display_name?: string } | null;
  created_at: number;
  /** Sort / "last activity" key (epoch ms). */
  modified_at: number;
  extra?: ConversationExtra | null;
  cron_job_id?: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  has_more: boolean;
}

// ── Message row (MessageResponse) ────────────────────────────────

export type MessagePosition = 'left' | 'right' | 'center' | 'pop';
export type MessageStatus = 'finish' | 'pending' | 'error' | 'work';

export interface StoredMessage {
  message_id: string;
  conversation_id: string;
  msg_id?: string | null;
  type: string;
  content: unknown;
  position?: MessagePosition | null;
  status?: MessageStatus | null;
  hidden?: boolean;
  created_at: number;
}

export interface TextContent {
  content?: string;
  replace?: boolean;
  senderName?: string;
}

export interface ThinkingContent {
  content?: string;
  subject?: string;
  duration?: number;
  status?: 'thinking' | 'done' | string;
}

export interface TipsContent {
  content?: string;
  type?: 'error' | 'success' | 'warning' | string;
  error?: AgentStreamErrorInfo;
  recovery?: TruncatedTurnRecovery;
}

export interface AgentStreamErrorInfo {
  message: string;
  code?: string;
  ownership?: string;
  detail?: string;
  workspacePath?: string;
  retryable?: boolean;
  feedback_recommended?: boolean;
  resolution?: { kind: string; target?: string };
}

export type TruncatedTurnRecovery = {
  kind: 'continue_truncated';
  source_message_id: string;
  failure_code: 'output_truncated' | 'turn_requests_exhausted';
};

export interface ToolCallContent {
  call_id?: string;
  name?: string;
  description?: string;
  status?: string;
  error?: unknown;
}

export type ToolGroupContent = ToolCallContent[];

// ── Turn receipts ────────────────────────────────────────────────

export interface SendMessageResult {
  msg_id: string;
  replayed?: boolean;
  completed?: boolean;
  result_ok?: boolean | null;
  result_text?: string | null;
  result_error?: string | null;
  result_error_code?: string | null;
  result_error_retryable?: boolean | null;
}

/** `CreateAgentSessionTurnResponseDto` — `message_id` is the accepted user row. */
interface CreateTurnResponse {
  agent_session_id: string;
  operation_id: string;
  message_id: string;
  status: string;
  replayed?: boolean;
  completed?: boolean;
  result_ok?: boolean | null;
  result_text?: string | null;
  result_error?: string | null;
  result_error_code?: string | null;
  result_error_retryable?: boolean | null;
}

export function normalizeSendMessageResult(
  result: CreateTurnResponse,
): SendMessageResult {
  return {
    // The accepted user message is the durable identity the stream merge keys
    // on; every other response field names the same turn as the old API did.
    msg_id: result.message_id,
    // A response without replay authority must fail closed. The durable
    // snapshot may reopen an already-running turn, but the phone must not
    // manufacture a fresh one from an ambiguous HTTP response.
    replayed: result.replayed !== false,
    completed: result.completed === true,
    result_ok: result.result_ok ?? null,
    result_text: result.result_text ?? null,
    result_error: result.result_error ?? null,
    result_error_code: result.result_error_code ?? null,
    result_error_retryable: result.result_error_retryable ?? null,
  };
}

// ── Paths (also used as SWR keys) ────────────────────────────────

export const CONVERSATION_PAGE_SIZE = 25;
export const MESSAGE_PAGE_SIZE = 40;

const AGENT_SESSIONS = '/api/agent-sessions';

/** `cursor` is the session id of the last row of the previous page. */
export function conversationsPath(cursor?: string, limit = CONVERSATION_PAGE_SIZE): string {
  const query = [`limit=${limit}`];
  if (cursor) query.push(`cursor=${encodeURIComponent(cursor)}`);
  return `${AGENT_SESSIONS}?${query.join('&')}`;
}

/**
 * Mutation path (`PATCH` metadata, `DELETE`). Reads that need the projected
 * Conversation row go through `conversationPath` — the bare resource returns
 * the canonical `SessionObservation`, not the UI projection.
 */
export function agentSessionPath(conversationId: string): string {
  return `${AGENT_SESSIONS}/${encodeURIComponent(conversationId)}`;
}

/** `ConversationResponse` for one session — the SWR key for `useConversation`. */
export function conversationPath(conversationId: string): string {
  return `${agentSessionPath(conversationId)}/projection`;
}

/**
 * Keyset history window. `cursor: ''` = newest window;
 * `'<created_at>:<message_id>'` = the window strictly older than that row.
 * The server returns each window oldest-first and reports `has_more`.
 */
export function messagesPath(
  conversationId: string,
  cursor = '',
  pageSize = MESSAGE_PAGE_SIZE,
): string {
  return (
    `${agentSessionPath(conversationId)}/message-history` +
    `?page_size=${pageSize}&cursor=${encodeURIComponent(cursor)}`
  );
}

/** Cursor that pages *older* than the given (already loaded) row. */
export function olderCursor(oldest: StoredMessage | undefined): string | undefined {
  if (!oldest) return undefined;
  return `${oldest.created_at}:${oldest.message_id}`;
}

// ── Reads ────────────────────────────────────────────────────────

export function fetchConversations(
  cursor?: string,
  limit = CONVERSATION_PAGE_SIZE,
): Promise<Paginated<Conversation>> {
  return api<Paginated<Conversation>>(conversationsPath(cursor, limit));
}

export function fetchConversation(conversationId: string): Promise<Conversation> {
  return api<Conversation>(conversationPath(conversationId));
}

export function fetchMessages(
  conversationId: string,
  cursor = '',
  pageSize = MESSAGE_PAGE_SIZE,
): Promise<Paginated<StoredMessage>> {
  return api<Paginated<StoredMessage>>(messagesPath(conversationId, cursor, pageSize));
}

// ── Create (official template → preset → AgentSession) ───────────

interface AgentPresetTemplate {
  template_key: string;
  seed?: { required_resource_kinds?: unknown };
}

interface AgentPresetLibrary {
  official_templates?: AgentPresetTemplate[];
  user_presets?: { preset_id: string }[];
}

interface AgentPresetEditorResponse {
  preset?: { preset_id?: string };
}

interface CreateSessionResponse {
  agent_session_id: string;
}

/** Templates preferred for a plain chat session, in order. */
const CHAT_TEMPLATE_KEYS = ['assistant.general', 'chat.minimal'] as const;

/**
 * The server does NOT fall back to the global default at send time — a session
 * created without a model may reject every turn. Mirror the desktop: resolve
 * the default client-side and stamp it into the create payload.
 */
async function resolveDefaultChatModel(): Promise<ModelRef | undefined> {
  let saved: ModelRef | undefined;
  try {
    const map = await api<Record<string, unknown>>('/api/settings/client');
    const raw = map?.['nomi.defaultModel'];
    if (raw && typeof raw === 'object') {
      const { provider_id, model } = raw as Record<string, unknown>;
      if (typeof provider_id === 'string' && provider_id && typeof model === 'string' && model) {
        saved = { provider_id, model };
      }
    }
  } catch {
    // fall through to task resolution
  }

  try {
    const providers = await listProviders();
    // Do not stamp a disabled/deleted/non-chat reference into a new session.
    // If it is still runnable, preserve the user's explicit default.
    if (isUsableModelRef(providers, saved, 'chat')) return saved;
    return firstUsableModel(providers, 'chat');
  } catch {
    // A transient catalog failure must not erase a valid saved reference. The
    // server will still validate it when the first message is sent.
    return saved;
  }
}

/**
 * AgentSessions are bound to a Preset, not created ad hoc. `reuse_existing`
 * makes the official template idempotent: the desktop materializes it once and
 * every later launch — desktop or phone — reuses the same preset.
 */
async function ensureChatPreset(
  model: ModelRef | undefined,
  displayName: string,
): Promise<{ presetId: string; resourceSelections: AgentResourceSelection[] }> {
  const library = await api<AgentPresetLibrary>(
    '/api/agent-preset-templates?source=official',
  );
  const templates = library.official_templates ?? [];
  const template =
    templates.find((t) => t.template_key === CHAT_TEMPLATE_KEYS[0]) ??
    templates.find((t) => t.template_key === CHAT_TEMPLATE_KEYS[1]) ??
    templates[0];
  if (!template) {
    throw new Error('The desktop reports no official Agent templates');
  }
  const resources = resolveRequiredResourceSelections(template.seed?.required_resource_kinds);
  if (!resources) {
    throw new Error(i18n.t('create.resourceManifestUnavailable', { ns: 'sessions' }));
  }
  if (resources.missingKinds.length > 0) {
    throw new Error(i18n.t('create.resourceSelectionRequired', {
      ns: 'sessions', kinds: resources.missingKinds.join(', '),
    }));
  }
  const editor = await api<AgentPresetEditorResponse>(
    `/api/agent-presets/from-template/${encodeURIComponent(template.template_key)}`,
    {
      body: {
        display_name: displayName,
        model_route_refs: {},
        chat_route_records: {},
        reuse_existing: true,
        ...(model ? { model: { provider_id: model.provider_id, model: model.model } } : {}),
      },
    },
  );
  const presetId = editor.preset?.preset_id;
  if (!presetId) {
    throw new Error('The desktop did not materialize an Agent preset');
  }
  return { presetId, resourceSelections: resources.selections };
}

export interface CreateConversationOptions {
  /**
   * Absolute directory on the desktop machine — supplying it freezes a
   * Workspace resource binding (`extra.workspace`). It must come from
   * `GET /api/fs/browse`; the server canonicalizes the path itself and rejects
   * a non-directory.
   */
  workspace?: string;
  /** Display name for the materialized official Agent preset. */
  agentDisplayName?: string;
}

/**
 * `POST /api/agent-sessions` —
 * `{preset_id, title?, model?, resource_selections?, workspace?}`.
 * The response only carries the id + binding, so the projected row is fetched
 * separately (what the desktop does immediately after create as well).
 */
export async function createConversation(
  name?: string,
  options: CreateConversationOptions = {},
): Promise<Conversation> {
  const model = await resolveDefaultChatModel();
  // Trim like the desktop's picker does: a stray edge space is rejected as
  // WORKSPACE_PATH_EDGE_WHITESPACE.
  const workspace = options.workspace?.trim();
  const { presetId, resourceSelections } = await ensureChatPreset(model, options.agentDisplayName ?? 'Nomi');
  const created = await api<CreateSessionResponse>(AGENT_SESSIONS, {
    body: {
      preset_id: presetId,
      ...(name ? { title: name } : {}),
      ...(model ? { model: { provider_id: model.provider_id, model: model.model } } : {}),
      ...(resourceSelections.length > 0 ? { resource_selections: resourceSelections } : {}),
      // The workspace selection admits the capability first; the desktop then
      // validates and freezes this user-selected directory into that binding.
      ...(workspace ? { workspace } : {}),
    },
    headers: { 'Idempotency-Key': newIdempotencyKey() },
  });
  return fetchConversation(created.agent_session_id);
}

// ── Metadata / lifecycle ─────────────────────────────────────────

/** `NomiCoreSessionMetadataUpdate` — presentation metadata only. */
export function patchConversation(
  conversationId: string,
  updates: { name?: string; pinned?: boolean; archived?: boolean },
): Promise<unknown> {
  return api<unknown>(agentSessionPath(conversationId), { method: 'PATCH', body: updates });
}

export function deleteConversation(conversationId: string): Promise<unknown> {
  return api<unknown>(agentSessionPath(conversationId), { method: 'DELETE' });
}

// ── Turns ────────────────────────────────────────────────────────

/** Visible-ASCII hex token; the server rejects empty / non-ASCII keys. */
export function newIdempotencyKey(): string {
  let out = '';
  while (out.length < 32) out += Math.floor(Math.random() * 0xffffffff).toString(16);
  return out.slice(0, 32);
}

/**
 * `POST /api/agent-sessions/{id}/turns` —
 * `{input: {content, files?}, idempotency_key}`.
 *
 * `input` accepts a bare string or the documented object; `files` are
 * **absolute paths on the desktop machine** (what `POST /api/fs/upload`
 * returned). The idempotency key travels in the body on this surface (the
 * `Idempotency-Key` header form is only honored by create/fork/delete).
 */
export function postMessage(
  conversationId: string,
  content: string,
  files: readonly string[] = [],
  idempotencyKey = newIdempotencyKey(),
): Promise<SendMessageResult> {
  const input: Record<string, unknown> = { content };
  if (files.length > 0) input.files = [...files];
  return api<CreateTurnResponse>(`${agentSessionPath(conversationId)}/turns`, {
    body: { input, idempotency_key: idempotencyKey },
  }).then(normalizeSendMessageResult);
}

/** `POST .../turns/cancel` — `{idempotency_key}` stops the active turn. */
export function cancelTurn(conversationId: string): Promise<unknown> {
  return api<unknown>(`${agentSessionPath(conversationId)}/turns/cancel`, {
    body: { idempotency_key: newIdempotencyKey() },
  });
}
