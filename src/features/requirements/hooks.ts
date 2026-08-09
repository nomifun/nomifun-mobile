/**
 * SWR hooks for the requirements platform.
 *
 * WS events are treated as invalidation signals, not patches — the desktop does
 * the same (`useRequirements.ts`), and there is no server-side replay, so the
 * synthetic `ws.reconnected` topic must refetch too.
 */
import { useCallback, useEffect, useRef } from 'react';
import useSWR, { useSWRConfig } from 'swr';

import { useWsTopic } from '@/hooks/use-ws';

import {
  REQUIREMENTS_BASE,
  REQUIREMENT_TAGS_KEY,
  requirementKey,
  requirementsListKey,
  type ListRequirementsParams,
} from './api';
import type { PaginatedResult, Requirement, TagSummary } from './types';

/** Requirement + AutoWork topics that make any cached requirement data stale. */
export const REQUIREMENT_LIVE_TOPICS = [
  'requirement.created',
  'requirement.updated',
  'requirement.statusChanged',
  'requirement.deleted',
  'autowork.statusChanged',
  'autowork.tagPaused',
  'ws.reconnected',
];

/** Refetch every cached `/api/requirements*` key (lists, detail rows, tags). */
export function useInvalidateRequirements(): () => void {
  const { mutate } = useSWRConfig();
  return useCallback(() => {
    void mutate((key) => typeof key === 'string' && key.startsWith(REQUIREMENTS_BASE));
  }, [mutate]);
}

/**
 * Subscribe a screen to live requirement changes. An AutoWork loop can emit a
 * burst of events per turn, so invalidation is coalesced on a short trailing
 * timer.
 */
export function useRequirementsLive(): void {
  const invalidate = useInvalidateRequirements();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useWsTopic(REQUIREMENT_LIVE_TOPICS, () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      invalidate();
    }, 250);
  });
}

export function useRequirementList(params: ListRequirementsParams) {
  return useSWR<PaginatedResult<Requirement>>(requirementsListKey(params));
}

export function useRequirementTags() {
  return useSWR<TagSummary[]>(REQUIREMENT_TAGS_KEY);
}

export function useRequirement(requirementId: string | undefined) {
  return useSWR<Requirement>(requirementId ? requirementKey(requirementId) : null);
}
