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
import { connectionStore } from '@/api/connection';
import type { RequestOptions } from '@/api/transport-client';
import { createConversationCommand } from './commands';
import { conversationListResponse, conversationResponse } from './wire';
export type { CreateConversationOptions, CreatedConversation } from './commands';

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
  active_turn_id?: string | null;
  processing_started_at?: number | null;
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
  user_input_request?: AgentUserInputRequest;
}

/** The host's normal handoff question; answering starts an ordinary new turn. */
export interface AgentUserInputRequest {
  request_id: string;
  question: string;
  remaining_work: string;
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

/** `ConversationResponse` for one session, shared by the catalog and detail readers. */
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

export type SessionReadOptions = Pick<RequestOptions, 'expectedEpoch' | 'signal'>;
export interface ConversationListOptions extends SessionReadOptions {
  expectedEpoch: number;
  cursor?: string;
  limit?: number;
}

export async function fetchConversationPage(
  path: string,
  options: SessionReadOptions & { expectedEpoch: number },
): Promise<Paginated<Conversation>> {
  return conversationListResponse(await api<unknown>(path, options));
}

export function fetchConversations(options: ConversationListOptions): Promise<Paginated<Conversation>> {
  const { cursor, limit, ...request } = options;
  return fetchConversationPage(conversationsPath(cursor, limit), request);
}

export async function fetchConversation(
  conversationId: string,
  options: SessionReadOptions = {},
): Promise<Conversation> {
  return conversationResponse(await api<unknown>(conversationPath(conversationId), options), 'conversation', conversationId);
}

export function fetchMessages(
  conversationId: string,
  cursor = '',
  pageSize = MESSAGE_PAGE_SIZE,
): Promise<Paginated<StoredMessage>> {
  return api<Paginated<StoredMessage>>(messagesPath(conversationId, cursor, pageSize));
}

// ── Create ─────────────────────────────────────────────────────────

/** All creation entry points use the same connection-bound commit command. */
export const createConversation = createConversationCommand(api, connectionStore.epoch);

// ── Metadata / lifecycle ─────────────────────────────────────────

/** `NomiCoreSessionMetadataUpdate` — presentation metadata only. */
export async function patchConversation(
  conversationId: string,
  updates: { name?: string; pinned?: boolean; archived?: boolean },
  options: SessionReadOptions = {},
): Promise<Conversation> {
  return conversationResponse(await api<unknown>(agentSessionPath(conversationId), {
    ...options, method: 'PATCH', body: updates,
  }), 'conversation', conversationId);
}

export function deleteConversation(conversationId: string, options: SessionReadOptions = {}): Promise<unknown> {
  return api<unknown>(agentSessionPath(conversationId), { ...options, method: 'DELETE' });
}

/** Model changes return the same authoritative projection as metadata writes. */
export async function patchConversationModel(
  conversationId: string,
  option: { providerId: string; model: string },
  options: SessionReadOptions = {},
): Promise<Conversation> {
  return conversationResponse(await api<unknown>(`${agentSessionPath(conversationId)}/model`, {
    ...options,
    method: 'PUT',
    body: { provider_id: option.providerId, model: option.model },
  }), 'conversation', conversationId);
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

/** Cancel the exact accepted input observed by the user, even if a successor starts. */
export function cancelTurn(conversationId: string, expectedTurnId: string, expectedEpoch: number): Promise<unknown> {
  return api<unknown>(`${agentSessionPath(conversationId)}/turns/cancel`, {
    body: { idempotency_key: newIdempotencyKey(), expected_turn_id: expectedTurnId },
    expectedEpoch,
  });
}
