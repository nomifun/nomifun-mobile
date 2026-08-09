/** Time formatting shared by the session list and the transcript. */
import dayjs from 'dayjs';

/** The narrow shape of i18next's `t` that these helpers need. */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "刚刚 / 3 分钟前 / 2 小时前 / 4 天前 / 2026-07-02" via common `time.*` keys. */
export function relativeTime(timestamp: number | undefined, t: Translate): string {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  if (diff < MINUTE) return t('time.justNow');
  if (diff < HOUR) return t('time.minutesAgo', { count: Math.floor(diff / MINUTE) });
  if (diff < DAY) return t('time.hoursAgo', { count: Math.floor(diff / HOUR) });
  if (diff < 7 * DAY) return t('time.daysAgo', { count: Math.floor(diff / DAY) });
  return dayjs(timestamp).format('YYYY-MM-DD');
}

/** Locale-neutral transcript divider: `HH:mm` today, `MM-DD HH:mm` before that. */
export function transcriptStamp(timestamp: number): string {
  const value = dayjs(timestamp);
  return value.isSame(dayjs(), 'day') ? value.format('HH:mm') : value.format('MM-DD HH:mm');
}

/** Insert a stamp when more than 10 minutes passed since the previous bubble. */
export function needsStamp(current: number, previous: number | undefined): boolean {
  if (previous === undefined) return true;
  return current - previous > 10 * MINUTE;
}
