import { ApiError } from '@/api/types';
import type { Conversation, Paginated } from './api';

function invalid(field: string): never {
  throw new ApiError(`Invalid session API response: ${field}`, 200, 'INVALID_API_RESPONSE');
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const text = (value: unknown): value is string => typeof value === 'string';
const identity = (value: unknown): value is string => text(value) && value.trim().length > 0;
const boolean = (value: unknown): value is boolean => typeof value === 'boolean';
const timestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function optional(
  value: Record<string, unknown>,
  field: string,
  check: (candidate: unknown) => boolean,
  path: string,
  nullable = false,
): void {
  if (value[field] !== undefined && !(nullable && value[field] === null) && !check(value[field])) {
    invalid(`${path}.${field}`);
  }
}

/** Reject incompatible projections before they can become an apparent empty list. */
export function conversationResponse(value: unknown, path = 'conversation', expectedId?: string): Conversation {
  if (!record(value)) invalid(path);
  if (!identity(value.conversation_id)) invalid(`${path}.conversation_id`);
  if (expectedId !== undefined && value.conversation_id !== expectedId) invalid(`${path}.conversation_id`);
  if (!text(value.name)) invalid(`${path}.name`);
  if (!identity(value.type)) invalid(`${path}.type`);
  if (!timestamp(value.created_at)) invalid(`${path}.created_at`);
  if (!timestamp(value.modified_at)) invalid(`${path}.modified_at`);
  optional(value, 'status', text, path);
  optional(value, 'source', text, path);
  optional(value, 'pinned', boolean, path);
  optional(value, 'pinned_at', timestamp, path);
  optional(value, 'preset_id', identity, path);
  optional(value, 'cron_job_id', identity, path);

  if (value.model !== undefined && value.model !== null) {
    if (!record(value.model)) invalid(`${path}.model`);
    for (const field of ['provider_id', 'model', 'use_model']) optional(value.model, field, text, `${path}.model`);
  }
  if (value.runtime !== undefined && value.runtime !== null) {
    if (!record(value.runtime)) invalid(`${path}.runtime`);
    for (const field of ['state', 'runtime_status']) optional(value.runtime, field, text, `${path}.runtime`);
    for (const field of ['can_send_message', 'has_runtime', 'is_processing']) {
      optional(value.runtime, field, boolean, `${path}.runtime`);
    }
    optional(value.runtime, 'active_turn_id', identity, `${path}.runtime`, true);
    optional(value.runtime, 'processing_started_at', timestamp, `${path}.runtime`, true);
  }
  if (value.agent_snapshot !== undefined && value.agent_snapshot !== null) {
    if (!record(value.agent_snapshot)) invalid(`${path}.agent_snapshot`);
    optional(value.agent_snapshot, 'display_name', text, `${path}.agent_snapshot`);
  }
  if (value.extra !== undefined && value.extra !== null) {
    if (!record(value.extra)) invalid(`${path}.extra`);
    for (const field of ['workspace', 'companion_id', 'channel_platform']) optional(value.extra, field, text, `${path}.extra`);
    optional(value.extra, 'is_temporary_workspace', boolean, `${path}.extra`);
    optional(value.extra, 'companion_session', candidate => boolean(candidate) || candidate === 0 || candidate === 1, `${path}.extra`);
  }
  return value as unknown as Conversation;
}

export function conversationListResponse(value: unknown): Paginated<Conversation> {
  if (!record(value) || !Array.isArray(value.items)) invalid('list.items');
  if (!timestamp(value.total) || value.total < value.items.length) invalid('list.total');
  if (!boolean(value.has_more)) invalid('list.has_more');
  if (value.has_more && value.items.length === 0) invalid('list.has_more');
  const ids = new Set<string>();
  for (let index = 0; index < value.items.length; index += 1) {
    const row = conversationResponse(value.items[index], `list.items[${index}]`);
    if (ids.has(row.conversation_id)) invalid(`list.items[${index}].conversation_id`);
    ids.add(row.conversation_id);
  }
  return value as unknown as Paginated<Conversation>;
}

export function createdConversationId(value: unknown): string {
  if (!record(value) || !identity(value.agent_session_id)) invalid('create.agent_session_id');
  return value.agent_session_id;
}
