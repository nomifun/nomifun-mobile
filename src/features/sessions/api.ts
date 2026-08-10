/**
 * Conversation (会话) HTTP surface.
 *
 * Wire contract lives in docs/research/feature-sessions.md. Two rules bite
 * here and are worth restating:
 *
 * - Rows carry `conversation_id` / `message_id`, never `id`.
 * - Request bodies are `deny_unknown_fields` on the Rust side, so every
 *   builder below sends *exactly* the documented keys (`extra` is required on
 *   create; `undefined` values are dropped by JSON.stringify).
 */
import { api } from '@/api/client';

import {
  confirmBody,
  normalizeConfirmations,
  type ConfirmationChoice,
  type PendingConfirmation,
} from './confirmations';

// ── Conversation row ───────────────────────────────────────────────

/** `{provider_id, model, use_model?}` — the nomi model reference on a row. */
export interface WireModel {
  provider_id?: string;
  model?: string;
  use_model?: string;
}

export interface ConversationRuntime {
  state?: 'idle' | 'starting' | 'running' | 'waiting_confirmation' | string;
  can_send_message?: boolean;
  has_runtime?: boolean;
  runtime_status?: string;
  is_processing?: boolean;
  pending_confirmations?: number;
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
   * Absolute agent cwd on the desktop machine. Non-empty + not temporary =
   * "project session" (there is no project table server-side).
   */
  workspace?: string;
  /**
   * Response-only, re-derived by the server on every read (`workspace` sits
   * under its data dir ⇒ auto-provisioned temp workspace). Never send it:
   * create strips it, and a PATCH that touches the temp-workspace bookkeeping
   * corrupts the row.
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

// ── Message row ────────────────────────────────────────────────────

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
}

export interface ToolCallContent {
  call_id?: string;
  name?: string;
  description?: string;
  status?: string;
  error?: unknown;
}

export type ToolGroupContent = ToolCallContent[];

export interface SendMessageResult {
  msg_id: string;
  replayed?: boolean;
  completed?: boolean;
  result_ok?: boolean | null;
  result_text?: string | null;
  result_error?: string | null;
}

// ── Paths (also used as SWR keys) ──────────────────────────────────

export const CONVERSATION_PAGE_SIZE = 25;
export const MESSAGE_PAGE_SIZE = 40;

/** `cursor` is the conversation_id of the last row of the previous page. */
export function conversationsPath(cursor?: string, limit = CONVERSATION_PAGE_SIZE): string {
  const query = [`limit=${limit}`];
  if (cursor) query.push(`cursor=${encodeURIComponent(cursor)}`);
  return `/api/conversations?${query.join('&')}`;
}

export function conversationPath(conversationId: string): string {
  return `/api/conversations/${encodeURIComponent(conversationId)}`;
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
    `${conversationPath(conversationId)}/messages` +
    `?page=1&page_size=${pageSize}&content_mode=compact&cursor=${encodeURIComponent(cursor)}`
  );
}

/** Cursor that pages *older* than the given (already loaded) row. */
export function olderCursor(oldest: StoredMessage | undefined): string | undefined {
  if (!oldest) return undefined;
  return `${oldest.created_at}:${oldest.message_id}`;
}

// ── Calls ──────────────────────────────────────────────────────────

export function fetchConversations(
  cursor?: string,
  limit = CONVERSATION_PAGE_SIZE,
): Promise<Paginated<Conversation>> {
  return api<Paginated<Conversation>>(conversationsPath(cursor, limit));
}

export function fetchMessages(
  conversationId: string,
  cursor = '',
  pageSize = MESSAGE_PAGE_SIZE,
): Promise<Paginated<StoredMessage>> {
  return api<Paginated<StoredMessage>>(messagesPath(conversationId, cursor, pageSize));
}

interface ModelRef {
  provider_id: string;
  model: string;
}

/**
 * The server does NOT fall back to the global default at send time — a Nomi
 * conversation created without a model rejects every message with
 * "no provider/model configured". Mirror the desktop: resolve the default
 * client-side and stamp it into the create payload.
 */
async function resolveDefaultChatModel(): Promise<ModelRef | undefined> {
  try {
    const map = await api<Record<string, unknown>>('/api/settings/client');
    const saved = map?.['nomi.defaultModel'];
    if (saved && typeof saved === 'object') {
      const { provider_id, model } = saved as Record<string, unknown>;
      if (typeof provider_id === 'string' && provider_id && typeof model === 'string' && model) {
        return { provider_id, model };
      }
    }
  } catch {
    // fall through to task resolution
  }
  try {
    const resolved = await api<{ models?: ModelRef[] }>('/api/model-profiles/resolve', {
      body: { task: 'chat' },
    });
    const first = resolved?.models?.find((m) => m.provider_id && m.model);
    if (first) return { provider_id: first.provider_id, model: first.model };
  } catch {
    // no model available — create without one; sends will surface the server hint
  }
  return undefined;
}

export interface CreateConversationOptions {
  /**
   * Absolute directory on the desktop machine — supplying it makes the new row
   * a *project session* (`extra.workspace`). It must come from
   * `GET /api/fs/browse` (the create endpoint does not check that the path
   * exists, so a hand-typed path only fails when the first message spawns the
   * agent process).
   */
  workspace?: string;
}

/**
 * `type` + `extra` are required by the server; the id is minted server-side.
 *
 * `extra` carries *only* `workspace`, and only when one was chosen:
 * - plain session → `extra: {}` and the server auto-provisions a temp
 *   workspace (and owns `temp_workspace_id` for it);
 * - project session → `extra: {workspace}`. `custom_workspace` is stripped
 *   server-side, `default_files` is never read, and `merge_extra` /
 *   `temp_workspace_id` / `is_temporary_workspace` must never be sent.
 */
export async function createConversation(
  name?: string,
  options: CreateConversationOptions = {},
): Promise<Conversation> {
  const model = await resolveDefaultChatModel();
  // Trim like the desktop's picker does: a stray edge space would make the
  // server reject the whole create with WORKSPACE_PATH_EDGE_WHITESPACE.
  const workspace = options.workspace?.trim();
  return api<Conversation>('/api/conversations', {
    body: {
      type: 'nomi',
      name,
      ...(model ? { model } : {}),
      extra: workspace ? { workspace } : {},
    },
  });
}

export function patchConversation(
  conversationId: string,
  updates: { name?: string; pinned?: boolean },
): Promise<unknown> {
  return api<unknown>(conversationPath(conversationId), { method: 'PATCH', body: updates });
}

export function deleteConversation(conversationId: string): Promise<unknown> {
  return api<unknown>(conversationPath(conversationId), { method: 'DELETE' });
}

/** Visible-ASCII hex token; the server rejects empty / non-ASCII keys. */
export function newIdempotencyKey(): string {
  let out = '';
  while (out.length < 32) out += Math.floor(Math.random() * 0xffffffff).toString(16);
  return out.slice(0, 32);
}

/**
 * `{content, files?}` + a per-attempt `Idempotency-Key` header.
 *
 * `files` are **absolute paths on the desktop machine** (what
 * `POST /api/fs/upload` returned); the key is omitted entirely when there are
 * no attachments, keeping the body to the documented minimum.
 */
export function postMessage(
  conversationId: string,
  content: string,
  files: readonly string[] = [],
  idempotencyKey = newIdempotencyKey(),
): Promise<SendMessageResult> {
  return api<SendMessageResult>(`${conversationPath(conversationId)}/messages`, {
    body: files.length > 0 ? { content, files: [...files] } : { content },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export function cancelTurn(conversationId: string): Promise<unknown> {
  return api<unknown>(`${conversationPath(conversationId)}/cancel`, { method: 'POST' });
}

// ── Tool approvals ─────────────────────────────────────────────────

export function confirmationsPath(conversationId: string): string {
  return `${conversationPath(conversationId)}/confirmations`;
}

/** `[]` when the conversation has no live runtime — never an error. */
export async function fetchConfirmations(conversationId: string): Promise<PendingConfirmation[]> {
  return normalizeConfirmations(await api<unknown>(confirmationsPath(conversationId)));
}

/**
 * Approve or deny one pending call: `{msg_id, data: {value}, always_allow}`.
 *
 * The body carries the option's **value**, never its label, and `always_allow`
 * is derived from that same option — see `confirmations.ts` for why both
 * matter (a lost value reads as approval on the agent side).
 */
export function submitConfirmation(
  conversationId: string,
  confirmation: PendingConfirmation,
  choice: ConfirmationChoice,
): Promise<unknown> {
  return api<unknown>(
    `${confirmationsPath(conversationId)}/${encodeURIComponent(confirmation.callId)}/confirm`,
    { body: confirmBody(confirmation, choice) },
  );
}
