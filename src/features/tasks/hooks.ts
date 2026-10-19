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
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { useSWRConfig } from 'swr';

import { toast } from '@/components/ui';
import { useWsTopic } from '@/hooks/use-ws';
import { useConnection } from '@/hooks/use-connection';
import { connectionStore } from '@/api/connection';

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
  // Every callback belongs to the connection that rendered its task. Remounts
  // do not prevent an already retained callback from being invoked later.
  const epoch = useConnection().epoch;
  const isCurrent = useCallback(() => connectionStore.epoch() === epoch, [epoch]);
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
      if (!isCurrent()) return;
      patchCaches({ ...job, enabled });
      try {
        const updated = await updateCronJob(job.cron_job_id, { enabled }, epoch);
        if (!isCurrent()) return;
        patchCaches(updated);
        toast.success(enabled ? t('feedback.resumed') : t('feedback.paused'));
      } catch (err) {
        if (!isCurrent()) return;
        revalidate(job.cron_job_id);
        toast.error(errorText(err, tc('feedback.requestFailed')));
      }
    },
    [epoch, isCurrent, patchCaches, revalidate, t, tc],
  );

  const runNow = useCallback(
    async (job: CronJob) => {
      if (!isCurrent()) return;
      let key: string | null = null;
      try {
        key = await claimRunNow(job.cron_job_id, epoch);
        // Another mounted screen already holds the claim for this intent.
        if (!key) return;
        // Transport checks the original epoch immediately before choosing the
        // address and credential, including the await-claim continuation gap.
        await runCronJobNow(job.cron_job_id, key, epoch);
        await completeRunNow(job.cron_job_id, key);
        if (!isCurrent()) return;
        toast.success(t('feedback.runQueued'));
        // The run emits job-updated + job-executed, but refresh anyway so a
        // dropped socket still shows the new history.
        revalidate(job.cron_job_id);
        void globalMutate(cronRunsKey(job.cron_job_id));
      } catch (err) {
        // Keep the persisted key so a retry reuses the same reservation.
        if (key) releaseRunNow(job.cron_job_id, key);
        if (!isCurrent()) return;
        toast.error(errorText(err, tc('feedback.requestFailed')));
      }
    },
    [epoch, isCurrent, globalMutate, revalidate, t, tc],
  );

  const remove = useCallback(
    async (job: CronJob) => {
      if (!isCurrent()) return false;
      try {
        await deleteCronJob(job.cron_job_id, epoch);
        if (!isCurrent()) return false;
        void globalMutate(
          CRON_JOBS_KEY,
          (prev: CronJob[] | undefined) =>
            (prev ?? []).filter((item) => item.cron_job_id !== job.cron_job_id),
          { revalidate: false },
        );
        toast.success(t('feedback.deleted'));
        return true;
      } catch (err) {
        if (!isCurrent()) return false;
        void globalMutate(CRON_JOBS_KEY);
        toast.error(errorText(err, tc('feedback.requestFailed')));
        return false;
      }
    },
    [epoch, isCurrent, globalMutate, t, tc],
  );

  const create = useCallback(
    async (payload: CronJobCreate) => {
      if (!isCurrent()) return null;
      try {
        const job = await createCronJob(payload, epoch);
        if (!isCurrent()) return null;
        patchCaches(job);
        toast.success(t('feedback.created'));
        return job;
      } catch (err) {
        if (!isCurrent()) return null;
        toast.error(errorText(err, tc('feedback.requestFailed')));
        return null;
      }
    },
    [epoch, isCurrent, patchCaches, t, tc],
  );

  const save = useCallback(
    async (id: string, updates: CronJobUpdate) => {
      if (!isCurrent()) return null;
      try {
        const job = await updateCronJob(id, updates, epoch);
        if (!isCurrent()) return null;
        patchCaches(job);
        toast.success(t('feedback.updated'));
        return job;
      } catch (err) {
        if (!isCurrent()) return null;
        revalidate(id);
        toast.error(errorText(err, tc('feedback.requestFailed')));
        return null;
      }
    },
    [epoch, isCurrent, patchCaches, revalidate, t, tc],
  );

  return { setEnabled, runNow, remove, create, save };
}
