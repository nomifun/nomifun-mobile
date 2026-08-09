/**
 * SWR hooks + realtime reducers for 定时任务.
 *
 * WebSocket delivery has **no replay**: any gap (reconnect, backgrounded app,
 * server lag resync) may have dropped `cron.*` events, so every hook refetches
 * its durable snapshot on `ws.reconnected` and on app foreground.
 *
 * The executor emits `cron.job-updated` (fresh `state`) *before*
 * `cron.job-executed`, so by the time an `executed` event arrives the cached
 * job already carries the new `last_status` / `next_run_at_ms`.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { AppState } from 'react-native';
import { useTranslation } from 'react-i18next';
import useSWR, { useSWRConfig } from 'swr';

import { toast } from '@/components/ui';
import { useWsTopic } from '@/hooks/use-ws';

import {
  CRON_CONVERSATIONS_KEY,
  CRON_JOBS_KEY,
  createCronJob,
  cronJobKey,
  cronRunsKey,
  deleteCronJob,
  listConversationOptions,
  runCronJobNow,
  updateCronJob,
} from './api';
import { claimRunNow, completeRunNow, releaseRunNow } from './run-now';
import type {
  CronConversationOption,
  CronJob,
  CronJobCreate,
  CronJobRun,
  CronJobUpdate,
} from './types';

const CRON_TOPICS = {
  created: 'cron.job-created',
  updated: 'cron.job-updated',
  removed: 'cron.job-removed',
  executed: 'cron.job-executed',
  reconnected: 'ws.reconnected',
} as const;

function asCronJob(data: unknown): CronJob | null {
  if (!data || typeof data !== 'object') return null;
  const candidate = data as Partial<CronJob>;
  return typeof candidate.cron_job_id === 'string' && candidate.state && candidate.schedule
    ? (candidate as CronJob)
    : null;
}

function jobIdOf(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const id = (data as { cron_job_id?: unknown }).cron_job_id;
  return typeof id === 'string' ? id : null;
}

function upsert(list: CronJob[] | undefined, job: CronJob): CronJob[] {
  const prev = list ?? [];
  const index = prev.findIndex((item) => item.cron_job_id === job.cron_job_id);
  if (index < 0) return [...prev, job];
  const next = prev.slice();
  next[index] = job;
  return next;
}

/** Soonest next run first; paused tasks sink to the bottom, newest-touched first. */
function sortJobs(jobs: CronJob[]): CronJob[] {
  return jobs.slice().sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    if (a.enabled) {
      const an = a.state.next_run_at_ms ?? Number.MAX_SAFE_INTEGER;
      const bn = b.state.next_run_at_ms ?? Number.MAX_SAFE_INTEGER;
      if (an !== bn) return an - bn;
    }
    return (b.metadata.updated_at ?? 0) - (a.metadata.updated_at ?? 0);
  });
}

/** Refetch whenever the app comes back to the foreground (guaranteed WS gap). */
function useForegroundRefresh(refresh: () => void) {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);
}

export interface CronJobsResult {
  jobs: CronJob[];
  total: number;
  activeCount: number;
  errorCount: number;
  isLoading: boolean;
  error: unknown;
  refresh: () => Promise<unknown>;
}

/** The list surface: full snapshot + live reducers for all four cron events. */
export function useCronJobs(): CronJobsResult {
  const { data, error, isLoading, mutate } = useSWR<CronJob[]>(CRON_JOBS_KEY);

  const refresh = useCallback(() => mutate(), [mutate]);

  const apply = useCallback(
    (job: CronJob) => {
      void mutate((prev) => upsert(prev, job), { revalidate: false });
    },
    [mutate],
  );

  useWsTopic(CRON_TOPICS.created, (payload) => {
    const job = asCronJob(payload);
    if (job) apply(job);
  });
  useWsTopic(CRON_TOPICS.updated, (payload) => {
    const job = asCronJob(payload);
    if (job) apply(job);
  });
  useWsTopic(CRON_TOPICS.removed, (payload) => {
    const id = jobIdOf(payload);
    if (!id) return;
    void mutate((prev) => (prev ?? []).filter((item) => item.cron_job_id !== id), {
      revalidate: false,
    });
  });
  // `job-updated` lands first and already carries fresh state; this is the
  // safety net for a dropped update.
  useWsTopic(CRON_TOPICS.executed, refresh);
  useWsTopic(CRON_TOPICS.reconnected, refresh);
  useForegroundRefresh(refresh);

  const jobs = useMemo(() => sortJobs(data ?? []), [data]);

  return {
    jobs,
    total: jobs.length,
    activeCount: jobs.filter((job) => job.enabled).length,
    errorCount: jobs.filter(
      (job) => job.state.last_status === 'error' || job.state.last_status === 'missed',
    ).length,
    isLoading: isLoading && !data,
    error,
    refresh,
  };
}

export interface CronJobResult {
  job: CronJob | undefined;
  isLoading: boolean;
  error: unknown;
  refresh: () => Promise<unknown>;
}

/** One task, kept live from `cron.job-updated` / `cron.job-removed`. */
export function useCronJob(id: string | undefined, onRemoved?: () => void): CronJobResult {
  const { data, error, isLoading, mutate } = useSWR<CronJob>(id ? cronJobKey(id) : null);

  const refresh = useCallback(() => mutate(), [mutate]);

  useWsTopic(CRON_TOPICS.updated, (payload) => {
    const job = asCronJob(payload);
    if (job && job.cron_job_id === id) void mutate(job, { revalidate: false });
  });
  useWsTopic(CRON_TOPICS.removed, (payload) => {
    if (jobIdOf(payload) === id) onRemoved?.();
  });
  useWsTopic(CRON_TOPICS.reconnected, refresh);
  useForegroundRefresh(refresh);

  return {
    job: data,
    isLoading: isLoading && !data,
    error,
    refresh,
  };
}

export interface CronRunsResult {
  runs: CronJobRun[];
  isLoading: boolean;
  error: unknown;
  refresh: () => Promise<unknown>;
}

/** Run history (latest 7, server-capped); refetched on every terminal outcome. */
export function useCronJobRuns(id: string | undefined): CronRunsResult {
  const { data, error, isLoading, mutate } = useSWR<CronJobRun[]>(id ? cronRunsKey(id) : null);

  const refresh = useCallback(() => mutate(), [mutate]);

  useWsTopic(CRON_TOPICS.executed, (payload) => {
    if (jobIdOf(payload) === id) refresh();
  });
  useWsTopic(CRON_TOPICS.reconnected, refresh);

  const runs = useMemo(
    () => (data ?? []).slice().sort((a, b) => b.executed_at_ms - a.executed_at_ms),
    [data],
  );

  return { runs, isLoading: isLoading && !data, error, refresh };
}

/** Conversations available to bind a new task to (create flow only). */
export function useCronConversationOptions(enabled: boolean) {
  const { data, error, isLoading } = useSWR<CronConversationOption[]>(
    enabled ? CRON_CONVERSATIONS_KEY : null,
    () => listConversationOptions(),
  );
  return { conversations: data ?? [], isLoading: isLoading && !data, error };
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Mutations shared by the list and detail screens. Each one updates the local
 * caches optimistically and refetches the authoritative snapshot on failure.
 */
export function useCronActions() {
  const { mutate: globalMutate } = useSWRConfig();
  const { t } = useTranslation('tasks');
  const { t: tc } = useTranslation('common');

  const patchCaches = useCallback(
    (job: CronJob) => {
      void globalMutate(cronJobKey(job.cron_job_id), job, { revalidate: false });
      void globalMutate(
        CRON_JOBS_KEY,
        (prev: CronJob[] | undefined) => upsert(prev, job),
        { revalidate: false },
      );
    },
    [globalMutate],
  );

  const revalidate = useCallback(
    (id: string) => {
      void globalMutate(CRON_JOBS_KEY);
      void globalMutate(cronJobKey(id));
    },
    [globalMutate],
  );

  const setEnabled = useCallback(
    async (job: CronJob, enabled: boolean) => {
      patchCaches({ ...job, enabled });
      try {
        const updated = await updateCronJob(job.cron_job_id, { enabled });
        patchCaches(updated);
        toast.success(enabled ? t('feedback.resumed') : t('feedback.paused'));
      } catch (err) {
        revalidate(job.cron_job_id);
        toast.error(errorText(err, tc('feedback.requestFailed')));
      }
    },
    [patchCaches, revalidate, t, tc],
  );

  const runNow = useCallback(
    async (job: CronJob) => {
      const key = await claimRunNow(job.cron_job_id);
      // Another mounted screen already holds the claim for this intent.
      if (!key) return;
      try {
        await runCronJobNow(job.cron_job_id, key);
        await completeRunNow(job.cron_job_id, key);
        toast.success(t('feedback.runQueued'));
        // The run emits job-updated + job-executed, but refresh anyway so a
        // dropped socket still shows the new history.
        revalidate(job.cron_job_id);
        void globalMutate(cronRunsKey(job.cron_job_id));
      } catch (err) {
        // Keep the persisted key so a retry reuses the same reservation.
        releaseRunNow(job.cron_job_id);
        toast.error(errorText(err, tc('feedback.requestFailed')));
      }
    },
    [globalMutate, revalidate, t, tc],
  );

  const remove = useCallback(
    async (job: CronJob) => {
      try {
        await deleteCronJob(job.cron_job_id);
        void globalMutate(
          CRON_JOBS_KEY,
          (prev: CronJob[] | undefined) =>
            (prev ?? []).filter((item) => item.cron_job_id !== job.cron_job_id),
          { revalidate: false },
        );
        toast.success(t('feedback.deleted'));
        return true;
      } catch (err) {
        void globalMutate(CRON_JOBS_KEY);
        toast.error(errorText(err, tc('feedback.requestFailed')));
        return false;
      }
    },
    [globalMutate, t, tc],
  );

  const create = useCallback(
    async (payload: CronJobCreate) => {
      try {
        const job = await createCronJob(payload);
        patchCaches(job);
        toast.success(t('feedback.created'));
        return job;
      } catch (err) {
        toast.error(errorText(err, tc('feedback.requestFailed')));
        return null;
      }
    },
    [patchCaches, t, tc],
  );

  const save = useCallback(
    async (id: string, updates: CronJobUpdate) => {
      try {
        const job = await updateCronJob(id, updates);
        patchCaches(job);
        toast.success(t('feedback.updated'));
        return job;
      } catch (err) {
        revalidate(id);
        toast.error(errorText(err, tc('feedback.requestFailed')));
        return null;
      }
    },
    [patchCaches, revalidate, t, tc],
  );

  return { setEnabled, runNow, remove, create, save };
}
