/**
 * Pure cron helpers — no dependencies.
 *
 * The desktop emits **6-field, seconds-first, Quartz-flavored** expressions
 * (`0 {m} {H} * * ?`) and uses `croner` purely as a UX aid: validation and the
 * "next runs" preview are advisory, the authoritative schedule is validated
 * server-side on save. This file reimplements just enough of that for mobile:
 *
 * - `describeSchedule` — the human-readable label shown in the list/detail.
 * - `parseCronExpression` / `nextCronRuns` — a tiny evaluator for the create
 *   form's live preview.
 *
 * Dialect rules copied from the desktop so the client stays in lockstep with
 * the Rust `cron` crate:
 * 1. Seconds are shown but default to `0`; a non-zero seconds field is a
 *    sub-minute task (allowed, but flagged — it is very expensive).
 * 2. Quartz extras `L` / `W` / `#` are rejected: the backend cannot parse them.
 */
import type { CronJob, CronSchedule } from './types';

/** Minimal `t()` shape so this module stays free of i18next types. */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

const DOW_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
const DOW_I18N = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const MONTH_NAMES = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;

/** Normalize any accepted expression to exactly six fields, or null if unusable. */
export function splitCronFields(expr: string): string[] | null {
  const trimmed = expr.trim();
  if (!trimmed) return null;
  let parts = trimmed.split(/\s+/);
  // Promote a legacy 5-field (Unix) expression to the canonical seconds-first form.
  if (parts.length === 5) parts = ['0', ...parts];
  if (parts.length < 6) return null;
  return parts.slice(0, 6);
}

/** A cron task with an empty expression can only ever be triggered manually. */
export function isManualOnly(job: CronJob): boolean {
  return job.schedule.kind === 'cron' && !job.schedule.expr.trim();
}

/** `?` means "no specific value" in Quartz; treat it as `*` for matching. */
function normalizeSlot(raw: string): string {
  return raw === '?' ? '*' : raw;
}

function isConcrete(field: string): boolean {
  return /^\d+$/.test(field);
}

function pad(value: string): string {
  return value.padStart(2, '0');
}

/**
 * Human label for a schedule, mirroring the desktop `formatSchedule`.
 * Falls back to the server-provided `description`, then the raw expression.
 */
export function describeSchedule(schedule: CronSchedule, t: Translate): string {
  if (schedule.kind === 'every') {
    if (schedule.every_ms === 3_600_000) return t('schedule.hourly');
    if (schedule.every_ms % 60_000 === 0) {
      return t('schedule.everyMinutes', { minutes: Math.round(schedule.every_ms / 60_000) });
    }
    return (
      schedule.description ??
      t('schedule.everySeconds', { seconds: Math.round(schedule.every_ms / 1000) })
    );
  }

  if (schedule.kind === 'at') {
    return t('schedule.once', { time: formatDateTime(schedule.at_ms) });
  }

  const expr = schedule.expr.trim();
  if (!expr) return t('schedule.manual');

  const fields = splitCronFields(expr);
  if (!fields) return schedule.description ?? t('schedule.cronRaw', { expr });

  const [seconds, minute, hour, domRaw, month, dowRaw] = fields;
  const dom = normalizeSlot(domRaw);
  const dow = normalizeSlot(dowRaw).toUpperCase();

  // Sub-minute schedules have no friendly preset label.
  if (seconds !== '0') return schedule.description ?? t('schedule.cronRaw', { expr });

  const allDates = dom === '*' && month === '*' && dow === '*';
  if (allDates && minute === '*' && hour === '*') return t('schedule.everyMinute');
  if (allDates && minute === '0' && hour === '*') return t('schedule.hourly');

  const time = `${pad(hour)}:${pad(minute)}`;
  if (allDates && isConcrete(hour) && isConcrete(minute)) {
    return t('schedule.dailyAt', { time });
  }
  if (dom === '*' && month === '*' && (dow === 'MON-FRI' || dow === '1-5')) {
    return t('schedule.weekdaysAt', { time });
  }
  const weekdayIndex = weekdayIndexOf(dow);
  if (dom === '*' && month === '*' && weekdayIndex !== null) {
    return t('schedule.weeklyAt', { day: t(`weekday.${DOW_I18N[weekdayIndex]}`), time });
  }

  return schedule.description ?? t('schedule.cronRaw', { expr });
}

/** Single weekday token (`MON` / `1`) → 0-6, else null. */
function weekdayIndexOf(token: string): number | null {
  const named = DOW_NAMES.indexOf(token as (typeof DOW_NAMES)[number]);
  if (named >= 0) return named;
  if (/^[0-7]$/.test(token)) return Number(token) % 7;
  return null;
}

// ---------------------------------------------------------------------------
// Expression evaluator (create-form preview only)
// ---------------------------------------------------------------------------

interface Slot {
  values: Set<number>;
  wildcard: boolean;
}

export interface ParsedCron {
  second: Slot;
  minute: Slot;
  hour: Slot;
  dayOfMonth: Slot;
  month: Slot;
  dayOfWeek: Slot;
  subMinute: boolean;
}

export type CronParseError = 'invalid' | 'unsupportedToken';

function slotOf(values: Set<number>, wildcard: boolean): Slot {
  return { values, wildcard };
}

function rangeSet(min: number, max: number, step = 1): Set<number> {
  const out = new Set<number>();
  for (let i = min; i <= max; i += step) out.add(i);
  return out;
}

/** Parse one field. Supports `*`, `?`, `n`, `a-b`, lists, and `/step`. */
function parseSlot(
  raw: string,
  min: number,
  max: number,
  names?: readonly string[],
  namesOffset = 0,
): Slot | null {
  const field = normalizeSlot(raw.trim()).toUpperCase();
  if (!field) return null;

  const resolve = (token: string): number | null => {
    if (/^\d+$/.test(token)) {
      const n = Number(token);
      return n >= min && n <= max ? n : null;
    }
    if (!names) return null;
    const idx = names.indexOf(token);
    return idx >= 0 ? idx + namesOffset : null;
  };

  const values = new Set<number>();
  let wildcard = false;

  for (const chunk of field.split(',')) {
    if (!chunk) return null;
    const [spec, stepRaw, ...rest] = chunk.split('/');
    if (rest.length) return null;
    let step = 1;
    if (stepRaw !== undefined) {
      if (!/^\d+$/.test(stepRaw) || Number(stepRaw) < 1) return null;
      step = Number(stepRaw);
    }

    if (spec === '*') {
      wildcard = stepRaw === undefined;
      for (const v of rangeSet(min, max, step)) values.add(v);
      continue;
    }

    if (spec.includes('-')) {
      const [fromRaw, toRaw, ...extra] = spec.split('-');
      if (extra.length) return null;
      const from = resolve(fromRaw);
      const to = resolve(toRaw);
      if (from === null || to === null) return null;
      if (from <= to) {
        for (const v of rangeSet(from, to, step)) values.add(v);
      } else {
        // Wrapping range (e.g. FRI-MON).
        for (let v = from; v <= max; v += step) values.add(v);
        for (let v = min; v <= to; v += step) values.add(v);
      }
      continue;
    }

    const single = resolve(spec);
    if (single === null) return null;
    if (stepRaw === undefined) {
      values.add(single);
    } else {
      for (const v of rangeSet(single, max, step)) values.add(v);
    }
  }

  return values.size ? slotOf(values, wildcard) : null;
}

/** Quartz `L` / `W` / `#` are unsupported by the backend `cron` crate. */
function hasUnsupportedQuartzTokens(fields: string[]): boolean {
  const dom = fields[3].toUpperCase();
  const dow = fields[5].toUpperCase();
  // `WED` legitimately contains a W, so only day-of-month is checked for it.
  return /[LW]/.test(dom) || /[#L]/.test(dow);
}

export function parseCronExpression(expr: string): ParsedCron | CronParseError {
  const fields = splitCronFields(expr);
  if (!fields) return 'invalid';
  if (hasUnsupportedQuartzTokens(fields)) return 'unsupportedToken';

  const second = parseSlot(fields[0], 0, 59);
  const minute = parseSlot(fields[1], 0, 59);
  const hour = parseSlot(fields[2], 0, 23);
  const dayOfMonth = parseSlot(fields[3], 1, 31);
  const month = parseSlot(fields[4], 1, 12, MONTH_NAMES, 1);
  const dayOfWeek = parseSlot(fields[5], 0, 6, DOW_NAMES, 0);
  if (!second || !minute || !hour || !dayOfMonth || !month || !dayOfWeek) return 'invalid';
  // `7` is a legal Sunday alias.
  if (dayOfWeek.values.has(7)) dayOfWeek.values.add(0);

  return {
    second,
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
    subMinute: fields[0] !== '0',
  };
}

function matchesDate(cron: ParsedCron, date: Date): boolean {
  if (!cron.month.values.has(date.getMonth() + 1)) return false;
  const domMatch = cron.dayOfMonth.values.has(date.getDate());
  const dowMatch = cron.dayOfWeek.values.has(date.getDay());
  // Vixie/Quartz semantics: when both day fields are restricted they OR.
  if (cron.dayOfMonth.wildcard) return dowMatch;
  if (cron.dayOfWeek.wildcard) return domMatch;
  return domMatch || dowMatch;
}

const TWO_YEARS_MS = 2 * 366 * 24 * 60 * 60 * 1000;

/**
 * Next `count` fire times in the device's local zone. Advisory only — the host
 * process owns the real schedule and may apply a small random delay.
 */
export function nextCronRuns(expr: string, count = 3, from: Date = new Date()): Date[] {
  const cron = parseCronExpression(expr);
  if (typeof cron === 'string') return [];

  const cursor = new Date(from.getTime());
  cursor.setMilliseconds(0);
  cursor.setSeconds(cursor.getSeconds() + 1);
  const deadline = from.getTime() + TWO_YEARS_MS;

  const out: Date[] = [];
  let guard = 0;
  while (out.length < count && cursor.getTime() < deadline && guard < 400_000) {
    guard += 1;
    if (!matchesDate(cron, cursor)) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    if (!cron.hour.values.has(cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!cron.minute.values.has(cursor.getMinutes())) {
      cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
      continue;
    }
    if (!cron.second.values.has(cursor.getSeconds())) {
      cursor.setSeconds(cursor.getSeconds() + 1, 0);
      continue;
    }
    out.push(new Date(cursor.getTime()));
    cursor.setSeconds(cursor.getSeconds() + 1);
  }
  return out;
}

export interface CronValidation {
  valid: boolean;
  /** i18n key suffix under `form.cron.*` when invalid. */
  error?: CronParseError | 'noUpcomingRun';
  nextRuns: Date[];
  subMinute: boolean;
}

export function validateCronExpression(expr: string, count = 3): CronValidation {
  const parsed = parseCronExpression(expr);
  if (typeof parsed === 'string') return { valid: false, error: parsed, nextRuns: [], subMinute: false };
  const runs = nextCronRuns(expr, count);
  if (!runs.length) {
    return { valid: false, error: 'noUpcomingRun', nextRuns: [], subMinute: parsed.subMinute };
  }
  return { valid: true, nextRuns: runs, subMinute: parsed.subMinute };
}

/** IANA zone of this device, stamped onto schedules we create (like desktop). */
export function currentCronTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.trim() ? tz : 'UTC';
  } catch {
    return 'UTC';
  }
}

export function buildCronSchedule(expr: string, description: string): CronSchedule {
  return { kind: 'cron', expr, tz: currentCronTimeZone(), description };
}

// ---------------------------------------------------------------------------
// Timestamp formatting
// ---------------------------------------------------------------------------

function twoDigit(n: number): string {
  return String(n).padStart(2, '0');
}

/** `08-10 09:00`, or `2027-01-02 09:00` when the year differs from today. */
export function formatDateTime(ms?: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const time = `${twoDigit(d.getHours())}:${twoDigit(d.getMinutes())}`;
  const date = `${twoDigit(d.getMonth() + 1)}-${twoDigit(d.getDate())}`;
  return d.getFullYear() === now.getFullYear()
    ? `${date} ${time}`
    : `${d.getFullYear()}-${date} ${time}`;
}

export function formatClock(date: Date): string {
  return `${twoDigit(date.getMonth() + 1)}-${twoDigit(date.getDate())} ${twoDigit(date.getHours())}:${twoDigit(date.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Status derivation
// ---------------------------------------------------------------------------

export type JobStatus = 'paused' | 'error' | 'active' | 'manual';
export type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral';

/** Priority mirrors the desktop `CronStatusTag`: paused → error → active. */
export function jobStatusOf(job: CronJob): JobStatus {
  if (isManualOnly(job)) return 'manual';
  if (!job.enabled) return 'paused';
  if (job.state.last_status === 'error' || job.state.last_status === 'missed') return 'error';
  return 'active';
}

export const JOB_STATUS_TONE: Record<JobStatus, Tone> = {
  paused: 'neutral',
  error: 'danger',
  active: 'success',
  manual: 'primary',
};

export const RUN_STATUS_TONE: Record<string, Tone> = {
  ok: 'success',
  error: 'danger',
  skipped: 'warning',
  missed: 'warning',
  running: 'primary',
};

export function runStatusTone(status?: string): Tone {
  return (status && RUN_STATUS_TONE[status]) || 'neutral';
}
