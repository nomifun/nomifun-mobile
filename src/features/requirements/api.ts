/**
 * Requirements platform endpoints (`/api/requirements/*`).
 *
 * Every SWR key in this feature is a real request path prefixed with
 * `REQUIREMENTS_BASE`, so a single prefix matcher invalidates the whole feature
 * (see hooks.ts). Bodies carry exactly the documented fields — the server uses
 * `deny_unknown_fields`.
 */
import { api } from '@/api/client';

import type { PaginatedResult, Requirement, RequirementStatus, TagSummary } from './types';

export const REQUIREMENTS_BASE = '/api/requirements';
export const REQUIREMENT_TAGS_KEY = `${REQUIREMENTS_BASE}/tags`;

/** Server clamp on `page_size` (1–200). */
export const MAX_PAGE_SIZE = 200;

export interface ListRequirementsParams {
  tag?: string;
  status?: RequirementStatus;
  q?: string;
  order_by?: 'display_no' | 'requirement_id' | 'created_at' | 'updated_at' | 'status';
  order?: 'asc' | 'desc';
  page?: number;
  page_size?: number;
}

/** Build the list path. Param order is fixed so the SWR cache key is stable. */
export function requirementsListKey(params: ListRequirementsParams = {}): string {
  const parts: string[] = [];
  const push = (key: string, value: string | number | undefined) => {
    if (value === undefined || value === '') return;
    parts.push(`${key}=${encodeURIComponent(String(value))}`);
  };
  push('tag', params.tag);
  push('status', params.status);
  push('q', params.q);
  push('order_by', params.order_by);
  push('order', params.order);
  push('page', params.page);
  push('page_size', params.page_size);
  return parts.length > 0 ? `${REQUIREMENTS_BASE}?${parts.join('&')}` : REQUIREMENTS_BASE;
}

export const requirementKey = (requirementId: string): string =>
  `${REQUIREMENTS_BASE}/${encodeURIComponent(requirementId)}`;

export interface CreateRequirementInput {
  title: string;
  tag: string;
  content?: string;
}

/** POST /api/requirements → 201 with the full row. */
export function createRequirement(input: CreateRequirementInput): Promise<Requirement> {
  return api<Requirement>(REQUIREMENTS_BASE, {
    body: { title: input.title, tag: input.tag, content: input.content ?? '' },
  });
}

export interface UpdateRequirementInput {
  title?: string;
  content?: string;
  tag?: string;
}

/**
 * PUT /api/requirements/{id} — metadata only. Status stays out of this call so
 * the dedicated CAS-guarded status path remains authoritative.
 */
export function updateRequirement(
  requirementId: string,
  patch: UpdateRequirementInput,
): Promise<Requirement> {
  return api<Requirement>(requirementKey(requirementId), { method: 'PUT', body: patch });
}

/** POST /api/requirements/{id}/status — never send `in_progress`. */
export function setRequirementStatus(
  requirementId: string,
  status: Exclude<RequirementStatus, 'in_progress'>,
  note?: string,
): Promise<Requirement> {
  return api<Requirement>(`${requirementKey(requirementId)}/status`, {
    body: { status, note: note && note.trim() !== '' ? note : undefined },
  });
}

/** POST /api/requirements/{id}/complete — mark done and attach the report. */
export function completeRequirement(
  requirementId: string,
  completionNote?: string,
): Promise<Requirement> {
  return api<Requirement>(`${requirementKey(requirementId)}/complete`, {
    body: {
      completion_note:
        completionNote && completionNote.trim() !== '' ? completionNote : undefined,
    },
  });
}

export function deleteRequirement(requirementId: string): Promise<unknown> {
  return api<unknown>(requirementKey(requirementId), { method: 'DELETE' });
}

export function fetchRequirements(
  params: ListRequirementsParams = {},
): Promise<PaginatedResult<Requirement>> {
  return api<PaginatedResult<Requirement>>(requirementsListKey(params));
}

export function fetchRequirementTags(): Promise<TagSummary[]> {
  return api<TagSummary[]>(REQUIREMENT_TAGS_KEY);
}
