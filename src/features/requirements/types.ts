/**
 * Wire types for the requirements platform (AutoWork).
 *
 * Mirrors `crates/backend/nomifun-api-types/src/requirement.rs` on the desktop
 * server. Ids cross the wire as bare UUIDv7 strings; the mobile client treats
 * them as opaque.
 */

export type RequirementStatus =
  | 'pending'
  | 'in_progress'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'needs_review';

/** Board/segment order: queue first, outcomes last. */
export const REQUIREMENT_STATUSES = [
  'pending',
  'in_progress',
  'needs_review',
  'done',
  'failed',
  'cancelled',
] as const satisfies readonly RequirementStatus[];

export type StatusFilter = 'all' | RequirementStatus;

export const STATUS_FILTERS = ['all', ...REQUIREMENT_STATUSES] as const satisfies readonly StatusFilter[];

/** Matches the `tone` union accepted by the UI kit's `Tag`. */
export type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral';

export const STATUS_TONE: Record<RequirementStatus, Tone> = {
  pending: 'neutral',
  in_progress: 'primary',
  needs_review: 'warning',
  done: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

export interface RequirementAttachment {
  attachment_id: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  created_at: number;
  abs_path: string;
}

export interface Requirement {
  requirement_id: string;
  /** Immutable human id, rendered as `#N`. */
  display_no: number;
  title: string;
  /** The instruction handed to the executing agent / CLI. */
  content: string;
  tag: string;
  /** Lexicographic queue order ('1.0', '1.2.1', …). */
  order_key: string;
  status: RequirementStatus;
  /** Tail-biased agent report (server caps it at 4000 chars). */
  completion_note?: string;
  /** Informational only — a requirement rotates across sessions. */
  owner_conversation_id?: string;
  owner_terminal_id?: string;
  started_at?: number;
  completed_at?: number;
  /** Retries so far; the only progress signal the platform exposes. */
  attempt_count: number;
  created_by: string;
  created_at: number;
  updated_at: number;
  /** Present on get/create/update responses only (list rows omit them). */
  attachments?: RequirementAttachment[];
}

/** Per-tag status counts + AutoWork pause state (`GET /api/requirements/tags`). */
export interface TagSummary {
  tag: string;
  pending: number;
  in_progress: number;
  done: number;
  failed: number;
  cancelled: number;
  needs_review: number;
  total: number;
  paused: boolean;
  paused_reason?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  has_more?: boolean;
}

/**
 * Status edges the server accepts from a human. Derived from
 * `RequirementService::set_status`:
 * - `in_progress` is execution authority only (never sent by a client);
 * - `pending` is reachable only from `failed` / `needs_review` (explicit requeue);
 * - a row that is `in_progress` cannot be judged from outside the claim;
 * - `done` / `failed` / `cancelled` are frozen — re-running means a new row.
 */
export const ALLOWED_TRANSITIONS: Record<RequirementStatus, readonly RequirementStatus[]> = {
  pending: ['done', 'failed', 'cancelled'],
  needs_review: ['done', 'pending', 'failed', 'cancelled'],
  failed: ['pending'],
  in_progress: [],
  done: [],
  cancelled: [],
};

/** Frozen rows only accept deletion. */
export function isTerminalStatus(status: RequirementStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled';
}
