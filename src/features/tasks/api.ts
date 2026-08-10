/**
 * `nomifun-cron` HTTP endpoints.
 *
 * Every route is owner-scoped server-side and returns the standard
 * `{success, data}` envelope, so `api()` hands back the payload directly.
 */
import { api } from '@/api/client';

import type {
  CronConversationOption,
  CronJob,
  CronJobCreate,
  CronJobRun,
  CronJobUpdate,
} from './types';

export const CRON_JOBS_KEY = '/api/cron/jobs';

export function cronJobKey(id: string): string {
  return `/api/cron/jobs/${id}`;
}

export function cronRunsKey(id: string): string {
  return `/api/cron/jobs/${id}/runs`;
}

export function listCronJobs(): Promise<CronJob[]> {
  return api<CronJob[]>(CRON_JOBS_KEY);
}

export function getCronJob(id: string): Promise<CronJob> {
  return api<CronJob>(cronJobKey(id));
}

/** Capped server-side at the latest 7 runs; there is no pagination. */
export function listCronJobRuns(id: string): Promise<CronJobRun[]> {
  return api<CronJobRun[]>(cronRunsKey(id));
}

/**
 * `UpdateCronJobRequest` is `deny_unknown_fields`: `execution_mode`, `metadata`
 * and `state` must never appear. Omitted fields are left untouched server-side.
 */
export function updateCronJob(id: string, updates: CronJobUpdate): Promise<CronJob> {
  return api<CronJob>(cronJobKey(id), { method: 'PUT', body: updates });
}

export function createCronJob(payload: CronJobCreate): Promise<CronJob> {
  return api<CronJob>(CRON_JOBS_KEY, { method: 'POST', body: payload });
}

/**
 * Deletes the task only. Conversations it was bound to — or created — and their
 * messages survive (verified against `nomifun-cron`'s delete path), so the
 * confirmation copy must not promise otherwise.
 */
export function deleteCronJob(id: string): Promise<unknown> {
  return api<unknown>(cronJobKey(id), { method: 'DELETE' });
}

/**
 * Fire the task immediately. The server rejects the request unless exactly one
 * ASCII `Idempotency-Key` header (1..=128 visible bytes) is present; it becomes
 * the operation id, so replaying the same key returns the same reservation
 * instead of firing a second run. Always go through `./run-now.ts`.
 */
export function runCronJobNow(
  id: string,
  idempotencyKey: string,
): Promise<{ conversation_id?: string }> {
  return api<{ conversation_id?: string }>(`${cronJobKey(id)}/run`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

interface ConversationRow {
  conversation_id: string;
  name?: string;
  type?: string;
  modified_at?: number;
  extra?: { backend?: string } | null;
}

interface PaginatedConversations {
  items?: ConversationRow[];
}

/**
 * Resolve the backend key a conversation runs on — this becomes `agent_type`
 * when a task is bound to an existing thread (desktop:
 * `getBackendKeyFromConversation`, fallback `'claude'`).
 */
function backendKeyOf(row: ConversationRow): string {
  const type = row.type ?? '';
  if (type === 'acp') return row.extra?.backend ?? 'claude';
  if (type === 'openclaw-gateway') return row.extra?.backend ?? 'openclaw-gateway';
  if (type === 'remote') return 'remote';
  return type || 'claude';
}

export const CRON_CONVERSATIONS_KEY = '/api/conversations?limit=100';

/** Conversation options for the "bind to an existing chat" create flow. */
export async function listConversationOptions(): Promise<CronConversationOption[]> {
  const page = await api<PaginatedConversations>(CRON_CONVERSATIONS_KEY);
  return (page.items ?? []).map((row) => ({
    conversation_id: row.conversation_id,
    name: row.name?.trim() || row.conversation_id.slice(0, 8),
    type: row.type ?? '',
    agent_type: backendKeyOf(row),
    modified_at: row.modified_at ?? 0,
  }));
}
