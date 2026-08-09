/**
 * Client-side search + status filtering, ported from the desktop
 * `cronJobSearch.ts`. `GET /api/cron/jobs` is unpaginated, so filtering the
 * full snapshot locally is exactly what the desktop does.
 */
import type { CronJob } from './types';

export type StatusFilter = 'all' | 'active' | 'paused';

/** Everything a user might plausibly type, lowercased into one haystack. */
function haystackOf(job: CronJob): string {
  const schedule = job.schedule;
  const config = job.metadata.agent_config;
  const parts: (string | undefined)[] = [
    job.cron_job_id,
    job.cron_job_id.slice(0, 8),
    job.name,
    job.description,
    schedule.description,
    schedule.kind === 'cron' ? schedule.expr : undefined,
    job.message,
    job.execution_mode,
    job.metadata.conversation_id,
    job.metadata.conversation_id?.slice(0, 8),
    job.metadata.conversation_title,
    job.metadata.agent_type,
    config?.backend,
    config?.provider_id,
    config?.name,
    config?.model,
    config?.workspace,
  ];
  return parts.filter(Boolean).join(' ').toLowerCase();
}

export function filterCronJobs(jobs: CronJob[], query: string, status: StatusFilter): CronJob[] {
  const needle = query.trim().toLowerCase();
  return jobs.filter((job) => {
    if (status !== 'all' && job.enabled !== (status === 'active')) return false;
    if (!needle) return true;
    return haystackOf(job).includes(needle);
  });
}
