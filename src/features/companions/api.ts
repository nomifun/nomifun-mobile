/**
 * Typed endpoint functions + SWR keys for the companion feature.
 *
 * Endpoint truth: docs/research/feature-companions.md §4. Two invariants worth
 * repeating here because the server enforces them:
 * - every memory mutation MUST carry `companion_id` (the actor) or the row 404s;
 * - bodies are `deny_unknown_fields` — send exactly the documented fields.
 */
import { api } from '@/api/client';

import type {
  CompanionLearnResult,
  CompanionMemory,
  CompanionMemoryPage,
  CompanionProfile,
  CompanionProfilePatch,
  CompanionSharedConfig,
  CompanionSkillPage,
  CompanionThread,
  CompanionWeeklyDigest,
  CompanionWithStatus,
  MemoryKind,
  MemorySort,
  MemoryStatus,
  Robot,
  RobotStatus,
} from './types';

// ── SWR keys (the key IS the path) ──────────────────────────────────────────

export const ROSTER_KEY = '/api/companion/companions';
export const SHARED_CONFIG_KEY = '/api/companion/config';
export const ROBOTS_KEY = '/api/robots';
export const ROBOT_STATUSES_KEY = '/api/robots/statuses';

export const companionKey = (id: string) => `/api/companion/companions/${id}`;
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

export const fetchRoster = () => api<CompanionWithStatus[]>(ROSTER_KEY);

export const fetchSharedConfig = () => api<CompanionSharedConfig>(SHARED_CONFIG_KEY);

/** Creation takes exactly these two fields; the figure is a follow-up PATCH. */
export const createCompanion = (name: string, character: string) =>
  api<CompanionProfile>(ROSTER_KEY, { body: { name, character } });

export const patchCompanion = (id: string, patch: CompanionProfilePatch) =>
  api<CompanionProfile>(companionKey(id), { method: 'PATCH', body: patch });

export const deleteCompanion = (id: string) =>
  api<void>(companionKey(id), { method: 'DELETE' });

// ── Chat entry ─────────────────────────────────────────────────────────────

/** Pure read — never mints a conversation. */
export const fetchActiveThread = (id: string) =>
  api<{ conversation_id: string | null }>(`${companionKey(id)}/companion/active`);

/** Idempotent ensure. 400 when the companion has no chat model configured. */
export const ensureCompanionThread = (id: string) =>
  api<CompanionThread>(`${companionKey(id)}/companion/threads`, { body: {} });

// ── Learning ───────────────────────────────────────────────────────────────

export const runLearnPass = (id: string) =>
  api<CompanionLearnResult>(`${companionKey(id)}/learn/run`, { body: {} });

export const fetchWeeklyDigest = (id: string) => api<CompanionWeeklyDigest>(weeklyDigestKey(id));

export const fetchSkills = (id: string) => api<CompanionSkillPage>(skillsKey(id));

// ── Memory ─────────────────────────────────────────────────────────────────

export const fetchMemories = (query: MemoryQuery) =>
  api<CompanionMemoryPage>(memoriesKey(query));

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

// ── Robots (read-only on mobile) ───────────────────────────────────────────

export const fetchRobots = () => api<{ robots: Robot[] }>(ROBOTS_KEY);

export const fetchRobotStatuses = () => api<{ statuses: RobotStatus[] }>(ROBOT_STATUSES_KEY);
