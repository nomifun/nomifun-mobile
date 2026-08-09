/**
 * Timestamp formatting for the monitoring views. Server timestamps are epoch
 * millis (`now_ms()`); `toMillis` tolerates seconds just in case.
 */
import dayjs from 'dayjs';

import { toMillis } from './normalize';
import type { CsAgent } from './types';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * "服务商 · 模型" label, or undefined when no model is configured. The provider
 * row may have been deleted after the agent referenced it (provider_id is a
 * logical reference), so a missing name degrades to the bare model name.
 */
export function modelLabelOf(
  agent: CsAgent,
  providerName?: (providerId: string | null) => string | undefined,
): string | undefined {
  if (!agent.model) return undefined;
  const name = providerName?.(agent.provider_id);
  return name ? `${name} · ${agent.model}` : agent.model;
}

/** Relative label built from the shared `common.time.*` keys. */
export function relativeTimeLabel(timestamp: number, t: Translate): string {
  const ms = toMillis(timestamp);
  if (ms === 0) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return t('time.justNow');
  if (diff < 3_600_000) return t('time.minutesAgo', { count: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('time.hoursAgo', { count: Math.floor(diff / 3_600_000) });
  if (diff < 7 * 86_400_000) return t('time.daysAgo', { count: Math.floor(diff / 86_400_000) });
  return dayjs(ms).format('YYYY-MM-DD');
}

/** Wall-clock label for one transcript row. */
export function clockLabel(timestamp: number): string {
  const ms = toMillis(timestamp);
  if (ms === 0) return '';
  return dayjs(ms).isSame(dayjs(), 'day')
    ? dayjs(ms).format('HH:mm')
    : dayjs(ms).format('MM-DD HH:mm');
}
