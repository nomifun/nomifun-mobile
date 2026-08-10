/**
 * SWR + WebSocket wiring for the companion feature.
 *
 * There is no WS replay, so every hook also listens for `ws.reconnected` and
 * resnapshots. Per-companion hooks filter events by `companion_id` and keep the
 * profile bundled with its id so a switch reads as "not loaded yet" during the
 * same render (the desktop's `useNomi.ts:43-51` freshness gate).
 */
import { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';

import { useWsTopic } from '@/hooks/use-ws';

import {
  ROBOTS_KEY,
  ROBOT_STATUSES_KEY,
  ROSTER_KEY,
  SHARED_CONFIG_KEY,
  companionKey,
  memoriesKey,
  skillsKey,
  weeklyDigestKey,
  type MemoryQuery,
} from './api';
import type {
  CompanionMemoryPage,
  CompanionSharedConfig,
  CompanionSkillPage,
  CompanionWeeklyDigest,
  CompanionWithStatus,
  Robot,
  RobotStatus,
} from './types';
import { eventCompanionId, eventConcerns, sortRoster } from './utils';

/** Events that change the roster or any badge shown on it. */
const ROSTER_TOPICS = [
  'companion.created',
  'companion.deleted',
  'companion.config-updated',
  'companion.mood-changed',
  'companion.learn-finished',
  // `status.memories_active` is part of the roster payload, so a memory written
  // from any surface changes the 记忆 badge on the card.
  'companion.memory-created',
  'companion.memory-deleted',
  'ws.reconnected',
];

const MEMORY_TOPICS = [
  'companion.memory-created',
  'companion.memory-updated',
  'companion.memory-deleted',
  'ws.reconnected',
];

const SKILL_TOPICS = [
  'companion.skill-drafted',
  'companion.skill-learned',
  'companion.skill-archived',
  'ws.reconnected',
];

/** Manual pull-to-refresh flag around an async revalidation. */
function useManualRefresh(run: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(() => {
    setRefreshing(true);
    void (async () => {
      try {
        await run();
      } finally {
        setRefreshing(false);
      }
    })();
  }, [run]);
  return { refreshing, refresh };
}

export function useCompanionRoster() {
  const roster = useSWR<CompanionWithStatus[]>(ROSTER_KEY);
  const config = useSWR<CompanionSharedConfig>(SHARED_CONFIG_KEY);

  const revalidate = useCallback(
    () => Promise.all([roster.mutate(), config.mutate()]),
    [roster, config],
  );
  const { refreshing, refresh } = useManualRefresh(revalidate);

  useWsTopic(ROSTER_TOPICS, () => {
    void roster.mutate();
  });
  useWsTopic('ws.reconnected', () => {
    void config.mutate();
  });

  const companions = useMemo(() => sortRoster(roster.data ?? []), [roster.data]);

  return {
    companions,
    defaultCompanionId: config.data?.default_companion_id ?? null,
    error: roster.error as unknown,
    isLoading: roster.isLoading && !roster.data,
    refreshing,
    refresh,
    mutate: roster.mutate,
  };
}

export function useCompanionDetail(companionId: string) {
  const key = companionId ? companionKey(companionId) : null;
  const { data, error, isLoading, mutate } = useSWR<CompanionWithStatus>(key);
  const [learning, setLearning] = useState(false);

  // Freshness gate: never hand out another companion's profile mid-switch.
  const companion = data && data.companion_id === companionId ? data : undefined;

  const { refreshing, refresh } = useManualRefresh(useCallback(() => mutate(), [mutate]));

  useWsTopic(['companion.config-updated', 'companion.mood-changed'], (payload) => {
    if (eventConcerns(payload, companionId)) void mutate();
  });
  // The profile carries `status.memories_active` / `memories_archived`, so the
  // 总览 counters go stale unless a memory write also refreshes the profile.
  useWsTopic(['companion.memory-created', 'companion.memory-deleted'], (payload) => {
    if (eventConcerns(payload, companionId)) void mutate();
  });
  useWsTopic('companion.learn-started', (payload) => {
    if (eventConcerns(payload, companionId)) setLearning(true);
  });
  useWsTopic('companion.learn-finished', (payload) => {
    if (!eventConcerns(payload, companionId)) return;
    setLearning(false);
    void mutate();
  });
  useWsTopic('ws.reconnected', () => {
    setLearning(false);
    void mutate();
  });
  useWsTopic('companion.deleted', (payload) => {
    // Deleted from another surface: drop the profile so the screen shows the
    // "not found" state instead of stale identity fields.
    if (eventCompanionId(payload) === companionId) {
      void mutate(undefined, { revalidate: false });
    }
  });

  return {
    companion,
    status: companion?.status,
    error: error as unknown,
    isLoading: isLoading && !companion,
    learning,
    setLearning,
    refreshing,
    refresh,
    mutate,
  };
}

/** Overview extras: weekly digest, skills and the robots bound to this companion. */
export function useCompanionExtras(companionId: string) {
  const digest = useSWR<CompanionWeeklyDigest>(
    companionId ? weeklyDigestKey(companionId) : null,
  );
  const skills = useSWR<CompanionSkillPage>(companionId ? skillsKey(companionId) : null);
  const robots = useSWR<{ robots: Robot[] }>(companionId ? ROBOTS_KEY : null);
  const statuses = useSWR<{ statuses: RobotStatus[] }>(companionId ? ROBOT_STATUSES_KEY : null);

  useWsTopic(SKILL_TOPICS, (payload) => {
    if (eventConcerns(payload, companionId)) {
      void skills.mutate();
      void digest.mutate();
    }
  });
  useWsTopic('robot.status', () => {
    void statuses.mutate();
  });
  useWsTopic('ws.reconnected', () => {
    void Promise.all([digest.mutate(), skills.mutate(), robots.mutate(), statuses.mutate()]);
  });

  const boundRobots = useMemo(
    () => (robots.data?.robots ?? []).filter((r) => r.companion_id === companionId),
    [robots.data, companionId],
  );
  const phases = useMemo(() => {
    const map = new Map<string, RobotStatus>();
    for (const s of statuses.data?.statuses ?? []) map.set(s.robot_id, s);
    return map;
  }, [statuses.data]);

  const revalidate = useCallback(
    () => Promise.all([digest.mutate(), skills.mutate(), robots.mutate(), statuses.mutate()]),
    [digest, skills, robots, statuses],
  );

  return {
    digest: digest.data,
    skills: skills.data,
    skillsError: skills.error as unknown,
    boundRobots,
    robotsError: robots.error as unknown,
    phases,
    revalidate,
  };
}

/**
 * One growing window over a companion's memories. The window (not an offset
 * page cursor) keeps the list consistent with live memory events: a single SWR
 * key always describes exactly what is on screen.
 */
export function useCompanionMemories(query: MemoryQuery) {
  const key = query.companionId ? memoriesKey(query) : null;
  const { data, error, isLoading, mutate } = useSWR<CompanionMemoryPage>(key);
  const { refreshing, refresh } = useManualRefresh(useCallback(() => mutate(), [mutate]));

  useWsTopic(MEMORY_TOPICS, () => {
    void mutate();
  });

  return {
    items: data?.items ?? [],
    total: data?.total ?? 0,
    error: error as unknown,
    isLoading: isLoading && !data,
    refreshing,
    refresh,
    mutate,
  };
}
