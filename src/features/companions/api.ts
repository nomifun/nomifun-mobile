/**
 * Typed endpoint functions + SWR keys for the companion feature.
 *
 * Endpoint truth: Desktop's companion routes. Two invariants worth repeating
 * here because the server enforces them:
 * - every memory mutation MUST carry `companion_id` (the actor) or the row 404s;
 * - bodies are `deny_unknown_fields` — send exactly the documented fields.
 */
import { api } from '@/api/client';

import { companionKey, createCompanionProfileApi } from './companion-profile-api';
import { decideSkillBody } from './skills';
import type {
  CompanionLearnResult,
  CompanionMemory,
  CompanionProfile,
  CompanionSkill,
  CompanionThread,
  MemoryKind,
  MemorySort,
  MemoryStatus,
} from './types';

export { companionKey, createCompanionProfileApi } from './companion-profile-api';
export type { CompanionProfileRequestOptions } from './companion-profile-api';

// ── SWR keys (the key IS the path) ──────────────────────────────────────────

export const ROSTER_KEY = '/api/companion/companions';
export const SHARED_CONFIG_KEY = '/api/companion/config';
export const ROBOTS_KEY = '/api/robots';
export const ROBOT_STATUSES_KEY = '/api/robots/statuses';

export const skillsKey = (id: string, limit = 50) =>
  `/api/companion/companions/${id}/skills?limit=${limit}`;
export const weeklyDigestKey = (id: string, days = 7) =>
  `/api/companion/companions/${id}/weekly-digest?days=${days}`;

export interface MemoryQuery {
  companionId: string;
  status: MemoryStatus;
  kind?: MemoryKind | null;
  q?: string;
  sort?: MemorySort;
  limit?: number;
}

export function memoriesKey(query: MemoryQuery): string {
  const params = new URLSearchParams();
  params.set('companion_id', query.companionId);
  params.set('status', query.status);
  if (query.kind) params.set('kind', query.kind);
  if (query.q) params.set('q', query.q);
  params.set('sort', query.sort ?? (query.q ? 'relevance' : 'time'));
  params.set('limit', String(query.limit ?? 20));
  params.set('offset', '0');
  return `/api/companion/memories?${params.toString()}`;
}

// ── Roster / profile ───────────────────────────────────────────────────────

/** Creation takes exactly these two fields; the figure is a follow-up PATCH. */
export const createCompanion = (name: string, character: string) =>
  api<CompanionProfile>(ROSTER_KEY, { body: { name, character } });

export const { patchCompanion } = createCompanionProfileApi(api);

export const deleteCompanion = (id: string) =>
  api<void>(companionKey(id), { method: 'DELETE' });

// ── Chat entry ─────────────────────────────────────────────────────────────

/** Reuse the desktop receive Session; a new Session requires a default chat model. */
export const ensureCompanionThread = (id: string) =>
  api<CompanionThread>(`${companionKey(id)}/companion/threads`, { body: {} });

// ── Learning ───────────────────────────────────────────────────────────────

export const runLearnPass = (id: string) =>
  api<CompanionLearnResult>(`${companionKey(id)}/learn/run`, { body: {} });

/**
 * Draft approval: `POST …/skills/{companion_skill_id}/decide` with
 * `{accept, reason?}`.
 *
 * accept=true  → the draft is promoted (`active`) and `companion.skill-learned`
 *                fires;
 * accept=false → the draft is archived, a rejection feedback row is written
 *                with the optional reason, and the pattern behind it is marked
 *                `rejected` so it stops being re-proposed.
 * Deciding a row that is no longer a draft returns it unchanged (idempotent).
 */
export const decideCompanionSkill = (
  companionId: string,
  companionSkillId: string,
  accept: boolean,
  reason?: string,
) =>
  api<CompanionSkill>(`${companionKey(companionId)}/skills/${companionSkillId}/decide`, {
    body: decideSkillBody(accept, reason),
  });

// ── Memory ─────────────────────────────────────────────────────────────────

export const createMemory = (companionId: string, kind: MemoryKind, content: string) =>
  api<CompanionMemory>('/api/companion/memories', {
    body: { kind, content, companion_id: companionId },
  });

/**
 * `companion_id` is the companion DOING the edit, not a new owner — ownership is
 * fixed at write time and the store 404s a foreign row.
 */
export const updateMemory = (
  memoryId: string,
  companionId: string,
  patch: { content?: string; pinned?: boolean; status?: MemoryStatus },
) =>
  api<void>(`/api/companion/memories/${memoryId}`, {
    method: 'PUT',
    body: { companion_id: companionId, ...patch },
  });

export const deleteMemory = (memoryId: string, companionId: string) =>
  api<void>(
    `/api/companion/memories/${memoryId}?companion_id=${encodeURIComponent(companionId)}`,
    { method: 'DELETE' },
  );
