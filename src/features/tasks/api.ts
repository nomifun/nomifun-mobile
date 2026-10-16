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
export function updateCronJob(id: string, updates: CronJobUpdate, expectedEpoch: number): Promise<CronJob> {
  return api<CronJob>(cronJobKey(id), { method: 'PUT', body: updates, expectedEpoch });
}

export function createCronJob(payload: CronJobCreate, expectedEpoch: number): Promise<CronJob> {
  return api<CronJob>(CRON_JOBS_KEY, { method: 'POST', body: payload, expectedEpoch });
}

/**
 * Deletes the task only. Conversations it was bound to — or created — and their
 * messages survive (verified against `nomifun-cron`'s delete path), so the
 * confirmation copy must not promise otherwise.
 */
export function deleteCronJob(id: string, expectedEpoch: number): Promise<unknown> {
  return api<unknown>(cronJobKey(id), { method: 'DELETE', expectedEpoch });
}

/**
 * Fire the task immediately. The server rejects the request unless exactly one
 * ASCII `Idempotency-Key` header (1..=128 visible bytes) is present; it becomes
 * the operation id, so replaying the same key returns the same reservation
 * instead of firing a second run. Always go through `./run-now.ts`.
 * Pass the rendered action's epoch through the claim and this final transport
 * fence; awaiting storage can commit a different Desktop before this call.
 */
export function runCronJobNow(
  id: string,
  idempotencyKey: string,
  expectedEpoch: number,
): Promise<{ conversation_id?: string }> {
  return api<{ conversation_id?: string }>(`${cronJobKey(id)}/run`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    expectedEpoch,
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
 * Current desktop builds have one conversation engine (`nomi`). Legacy vendor
 * backend names are no longer valid create-time selectors.
 */
function backendKeyOf(row: ConversationRow): string {
  return row.type === 'nomi' ? 'nomi' : '';
}

export const CRON_CONVERSATIONS_KEY = '/api/agent-sessions?limit=100';

/** Conversation options for the "bind to an existing chat" create flow. */
export async function listConversationOptions(): Promise<CronConversationOption[]> {
  const page = await api<PaginatedConversations>(CRON_CONVERSATIONS_KEY);
  return (page.items ?? [])
    .filter((row) => row.type === 'nomi')
    .map((row) => ({
      conversation_id: row.conversation_id,
      name: row.name?.trim() || row.conversation_id.slice(0, 8),
      type: row.type ?? '',
      agent_type: backendKeyOf(row),
      modified_at: row.modified_at ?? 0,
    }));
}
