import { useTranslation } from 'react-i18next';

import { Tag } from '@/components/ui';

import { JOB_STATUS_TONE, jobStatusOf, runStatusTone } from '../cron';
import type { CronJob } from '../types';

/** Paused → error → active, matching the desktop `CronStatusTag` priority. */
export function JobStatusTag({ job }: { job: CronJob }) {
  const { t } = useTranslation('tasks');
  const status = jobStatusOf(job);
  return <Tag tone={JOB_STATUS_TONE[status]}>{t(`status.${status}`)}</Tag>;
}

/** One recorded run outcome: ok / error / skipped / missed. */
export function RunStatusTag({ status }: { status?: string }) {
  const { t } = useTranslation('tasks');
  const known = status === 'ok' || status === 'error' || status === 'skipped' || status === 'missed';
  return (
    <Tag tone={runStatusTone(status)}>
      {known ? t(`runStatus.${status}`) : (status ?? t('runStatus.none'))}
    </Tag>
  );
}
