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
  workspace?: string;
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

/** `type` + `extra` are required by the server; the id is minted server-side. */
export function createConversation(name?: string): Promise<Conversation> {
  return api<Conversation>('/api/conversations', {
    body: { type: 'nomi', name, extra: {} },
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

export function postMessage(
  conversationId: string,
  content: string,
  idempotencyKey = newIdempotencyKey(),
): Promise<SendMessageResult> {
  return api<SendMessageResult>(`${conversationPath(conversationId)}/messages`, {
    body: { content },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export function cancelTurn(conversationId: string): Promise<unknown> {
  return api<unknown>(`${conversationPath(conversationId)}/cancel`, { method: 'POST' });
}
