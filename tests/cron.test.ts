/**
 * `src/features/tasks/cron.ts` — the 6-field, seconds-first Quartz-flavoured
 * dialect the desktop emits, plus the advisory "next runs" preview.
 *
 * `describeSchedule` is exercised through a stub `t` that echoes the key and
 * its interpolation object, so the assertions read as "which label, with which
 * variables" without pulling i18next into the test.
 */
import { describe, expect, it } from 'bun:test';

import type { CronJob, CronSchedule } from '@/features/tasks/types';
import {
  type Translate,
  describeSchedule,
  formatDateTime,
  isManualOnly,
  jobStatusOf,
  nextCronRuns,
  parseCronExpression,
  runStatusTone,
  splitCronFields,
  validateCronExpression,
} from '@/features/tasks/cron';

/** Echoes `key` plus a stable rendering of the interpolation object. */
const t: Translate = (key, options) =>
  options === undefined ? key : `${key}|${JSON.stringify(options)}`;

const FROM = new Date(2026, 0, 1, 0, 0, 0); // local midnight, 2026-01-01 (a Thursday)

function job(overrides: Partial<CronJob> = {}): CronJob {
  return {
    cron_job_id: 'j1',
    name: 'job',
    enabled: true,
    schedule: { kind: 'cron', expr: '0 0 9 * * ?' },
    message: 'do it',
    execution_mode: 'existing',
    metadata: { agent_type: 'nomi', created_by: 'user', created_at: 0, updated_at: 0 },
    state: { run_count: 0, retry_count: 0, max_retries: 3 },
    ...overrides,
  };
}

describe('splitCronFields', () => {
  it('promotes a 5-field Unix expression to the seconds-first form', () => {
    expect(splitCronFields('0 9 * * *')).toEqual(['0', '0', '9', '*', '*', '*']);
  });

  it('passes a 6-field expression through', () => {
    expect(splitCronFields('30 0 9 * * ?')).toEqual(['30', '0', '9', '*', '*', '?']);
  });

  it('collapses irregular whitespace', () => {
    expect(splitCronFields('  0\t0   9 * * ?  ')).toEqual(['0', '0', '9', '*', '*', '?']);
  });

  it('truncates a 7-field (year) expression to six', () => {
    expect(splitCronFields('0 0 9 * * ? 2026')).toEqual(['0', '0', '9', '*', '*', '?']);
  });

  it('rejects empty and too-short input', () => {
    expect(splitCronFields('')).toBeNull();
    expect(splitCronFields('   ')).toBeNull();
    expect(splitCronFields('*')).toBeNull();
    expect(splitCronFields('0 9 * *')).toBeNull();
  });
});

describe('describeSchedule', () => {
  it('labels interval schedules', () => {
    expect(describeSchedule({ kind: 'every', every_ms: 3_600_000 }, t)).toBe('schedule.hourly');
    expect(describeSchedule({ kind: 'every', every_ms: 300_000 }, t)).toBe(
      'schedule.everyMinutes|{"minutes":5}',
    );
    expect(describeSchedule({ kind: 'every', every_ms: 30_000 }, t)).toBe(
      'schedule.everySeconds|{"seconds":30}',
    );
  });

  it('prefers a server description for a sub-minute interval', () => {
    expect(describeSchedule({ kind: 'every', every_ms: 5_000, description: '每 5 秒' }, t)).toBe(
      '每 5 秒',
    );
  });

  it('labels a one-shot schedule with a formatted timestamp', () => {
    const at = new Date(2026, 7, 10, 9, 5).getTime();
    expect(describeSchedule({ kind: 'at', at_ms: at }, t)).toBe(
      `schedule.once|{"time":"${formatDateTime(at)}"}`,
    );
  });

  it('calls an empty expression manual-only', () => {
    expect(describeSchedule({ kind: 'cron', expr: '   ' }, t)).toBe('schedule.manual');
  });

  it('recognizes the presets the create form offers', () => {
    expect(describeSchedule({ kind: 'cron', expr: '* * * * *' }, t)).toBe('schedule.everyMinute');
    expect(describeSchedule({ kind: 'cron', expr: '0 * * * *' }, t)).toBe('schedule.hourly');
    expect(describeSchedule({ kind: 'cron', expr: '0 0 9 * * ?' }, t)).toBe(
      'schedule.dailyAt|{"time":"09:00"}',
    );
    expect(describeSchedule({ kind: 'cron', expr: '0 5 9 * * MON-FRI' }, t)).toBe(
      'schedule.weekdaysAt|{"time":"09:05"}',
    );
    expect(describeSchedule({ kind: 'cron', expr: '0 30 8 * * 1-5' }, t)).toBe(
      'schedule.weekdaysAt|{"time":"08:30"}',
    );
    expect(describeSchedule({ kind: 'cron', expr: '0 0 8 * * MON' }, t)).toBe(
      'schedule.weeklyAt|{"day":"weekday.mon","time":"08:00"}',
    );
    expect(describeSchedule({ kind: 'cron', expr: '0 0 8 * * 0' }, t)).toBe(
      'schedule.weeklyAt|{"day":"weekday.sun","time":"08:00"}',
    );
    // `7` is a legal Sunday alias in this dialect.
    expect(describeSchedule({ kind: 'cron', expr: '0 0 8 * * 7' }, t)).toBe(
      'schedule.weeklyAt|{"day":"weekday.sun","time":"08:00"}',
    );
  });

  it('falls back to the raw expression when no preset matches', () => {
    expect(describeSchedule({ kind: 'cron', expr: '0 0 9 1 * ?' }, t)).toBe(
      'schedule.cronRaw|{"expr":"0 0 9 1 * ?"}',
    );
    // Sub-minute schedules have no friendly label at all.
    expect(describeSchedule({ kind: 'cron', expr: '*/10 * * * * *' }, t)).toBe(
      'schedule.cronRaw|{"expr":"*/10 * * * * *"}',
    );
    // A garbage expression still renders as itself rather than throwing.
    expect(describeSchedule({ kind: 'cron', expr: 'nonsense' }, t)).toBe(
      'schedule.cronRaw|{"expr":"nonsense"}',
    );
  });

  it('prefers the server description over the raw fallback', () => {
    const schedule: CronSchedule = { kind: 'cron', expr: '0 0 9 1 * ?', description: '每月一号' };
    expect(describeSchedule(schedule, t)).toBe('每月一号');
  });
});

describe('parseCronExpression', () => {
  it('rejects unparseable field values', () => {
    expect(parseCronExpression('a b c d e f')).toBe('invalid');
    expect(parseCronExpression('0 99 9 * * ?')).toBe('invalid');
    expect(parseCronExpression('0 0 9 0 * ?')).toBe('invalid'); // day-of-month is 1-based
    expect(parseCronExpression('0 0 9 * * ?/')).toBe('invalid');
    expect(parseCronExpression('0 0 9 * * 1-2-3')).toBe('invalid');
    expect(parseCronExpression('')).toBe('invalid');
  });

  it('rejects the Quartz extras the backend cron crate cannot parse', () => {
    expect(parseCronExpression('0 0 9 L * ?')).toBe('unsupportedToken');
    expect(parseCronExpression('0 0 9 15W * ?')).toBe('unsupportedToken');
    expect(parseCronExpression('0 0 9 ? * 6#3')).toBe('unsupportedToken');
    expect(parseCronExpression('0 0 9 ? * 6L')).toBe('unsupportedToken');
  });

  it('does not mistake WED for the Quartz `W` token', () => {
    const parsed = parseCronExpression('0 0 9 * * WED');
    expect(typeof parsed).toBe('object');
  });

  it('parses lists, ranges and steps', () => {
    const parsed = parseCronExpression('0 0,30 9-10 * * *');
    if (typeof parsed === 'string') throw new Error(`expected a parse, got ${parsed}`);
    expect([...parsed.minute.values].sort((a, b) => a - b)).toEqual([0, 30]);
    expect([...parsed.hour.values].sort((a, b) => a - b)).toEqual([9, 10]);
    expect(parsed.dayOfMonth.wildcard).toBe(true);
    expect(parsed.subMinute).toBe(false);
  });

  it('flags a non-zero seconds field as sub-minute', () => {
    const parsed = parseCronExpression('*/15 * * * * *');
    if (typeof parsed === 'string') throw new Error('expected a parse');
    expect(parsed.subMinute).toBe(true);
    // A stepped wildcard is an enumeration, not a wildcard.
    expect(parsed.second.wildcard).toBe(false);
  });

  it('treats `?` as a wildcard', () => {
    const parsed = parseCronExpression('0 0 9 ? * ?');
    if (typeof parsed === 'string') throw new Error('expected a parse');
    expect(parsed.dayOfMonth.wildcard).toBe(true);
    expect(parsed.dayOfWeek.wildcard).toBe(true);
  });
});

describe('nextCronRuns', () => {
  it('projects a daily schedule forward', () => {
    const runs = nextCronRuns('0 9 * * *', 3, FROM);
    expect(runs).toHaveLength(3);
    expect(runs.map((run) => [run.getDate(), run.getHours(), run.getMinutes()])).toEqual([
      [1, 9, 0],
      [2, 9, 0],
      [3, 9, 0],
    ]);
  });

  it('starts strictly after `from`', () => {
    const runs = nextCronRuns('0 9 * * *', 1, new Date(2026, 0, 1, 9, 0, 0));
    expect(runs[0].getDate()).toBe(2);
  });

  it('honours a weekday-only schedule', () => {
    // 2026-01-01 is a Thursday, so the run after Friday is the next Monday.
    const runs = nextCronRuns('0 0 9 * * MON-FRI', 3, FROM);
    expect(runs.map((run) => run.getDate())).toEqual([1, 2, 5]);
  });

  it('ORs the two day fields when both are restricted', () => {
    // 5th of the month OR every Monday.
    const runs = nextCronRuns('0 0 9 5 * MON', 3, FROM);
    expect(runs.map((run) => run.getDate())).toEqual([5, 12, 19]);
  });

  it('KNOWN DIVERGENCE: the evaluator rejects the `7` Sunday alias the label accepts', () => {
    // `describeSchedule` resolves `7` through `weekdayIndexOf` (`/^[0-7]$/`) and
    // happily prints "weekly on Sunday" — see the preset test above — but
    // `parseSlot` caps day-of-week at 6, so the same expression has no preview
    // at all. The dead `dayOfWeek.values.has(7)` branch in `parseCronExpression`
    // was clearly meant to cover this. Pinned here so a fix trips this test
    // instead of going unnoticed; the fix belongs in `src/features/tasks/cron.ts`.
    expect(parseCronExpression('0 0 9 ? * 7')).toBe('invalid');
    expect(nextCronRuns('0 0 9 ? * 7', 2, FROM)).toEqual([]);
    // `0` works and is the same day.
    expect(nextCronRuns('0 0 9 ? * 0', 2, FROM).map((run) => run.getDay())).toEqual([0, 0]);
  });

  it('walks a sub-minute schedule second by second', () => {
    const runs = nextCronRuns('*/30 * * * * *', 3, new Date(2026, 0, 1, 0, 0, 0));
    expect(runs.map((run) => run.getSeconds())).toEqual([30, 0, 30]);
  });

  it('returns nothing for a date that never happens', () => {
    // February never has a 30th, and the search window is two years.
    expect(nextCronRuns('0 0 0 30 2 ?', 3, FROM)).toEqual([]);
  });

  it('returns nothing for an unparseable expression', () => {
    expect(nextCronRuns('nope', 3, FROM)).toEqual([]);
    expect(nextCronRuns('0 0 9 L * ?', 3, FROM)).toEqual([]);
  });

  it('never returns more than asked for', () => {
    expect(nextCronRuns('* * * * *', 5, FROM)).toHaveLength(5);
    expect(nextCronRuns('* * * * *', 0, FROM)).toEqual([]);
  });
});

describe('validateCronExpression', () => {
  it('accepts a valid expression and previews its runs', () => {
    const result = validateCronExpression('0 9 * * *');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.nextRuns).toHaveLength(3);
    expect(result.subMinute).toBe(false);
  });

  it('reports the parse failure kind', () => {
    expect(validateCronExpression('a b c d e f').error).toBe('invalid');
    expect(validateCronExpression('').error).toBe('invalid');
    expect(validateCronExpression('0 0 9 L * ?').error).toBe('unsupportedToken');
  });

  it('reports a valid-but-never-firing expression separately', () => {
    const result = validateCronExpression('0 0 0 30 2 ?');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('noUpcomingRun');
    expect(result.nextRuns).toEqual([]);
  });

  it('flags an expensive sub-minute schedule while still accepting it', () => {
    const result = validateCronExpression('*/5 * * * * *');
    expect(result.valid).toBe(true);
    expect(result.subMinute).toBe(true);
  });

  it('honours the requested preview count', () => {
    expect(validateCronExpression('0 9 * * *', 5).nextRuns).toHaveLength(5);
  });
});

describe('job status derivation', () => {
  it('calls an empty cron expression manual-only', () => {
    expect(isManualOnly(job({ schedule: { kind: 'cron', expr: '' } }))).toBe(true);
    expect(isManualOnly(job({ schedule: { kind: 'every', every_ms: 1000 } }))).toBe(false);
    expect(isManualOnly(job())).toBe(false);
  });

  it('orders paused over error over active', () => {
    expect(jobStatusOf(job({ schedule: { kind: 'cron', expr: '' } }))).toBe('manual');
    expect(
      jobStatusOf(job({ enabled: false, state: { run_count: 1, retry_count: 0, max_retries: 3, last_status: 'error' } })),
    ).toBe('paused');
    expect(
      jobStatusOf(job({ state: { run_count: 1, retry_count: 0, max_retries: 3, last_status: 'error' } })),
    ).toBe('error');
    expect(
      jobStatusOf(job({ state: { run_count: 1, retry_count: 0, max_retries: 3, last_status: 'missed' } })),
    ).toBe('error');
    expect(jobStatusOf(job())).toBe('active');
  });

  it('maps run statuses onto tones, unknown included', () => {
    expect(runStatusTone('ok')).toBe('success');
    expect(runStatusTone('error')).toBe('danger');
    expect(runStatusTone('skipped')).toBe('warning');
    expect(runStatusTone(undefined)).toBe('neutral');
    expect(runStatusTone('brand-new-status')).toBe('neutral');
  });
});

describe('formatDateTime', () => {
  it('omits the year for the current year and keeps it otherwise', () => {
    const thisYear = new Date();
    thisYear.setMonth(7, 10);
    thisYear.setHours(9, 5, 0, 0);
    expect(formatDateTime(thisYear.getTime())).toBe('08-10 09:05');

    const otherYear = new Date(thisYear.getTime());
    otherYear.setFullYear(thisYear.getFullYear() + 1);
    expect(formatDateTime(otherYear.getTime())).toBe(
      `${otherYear.getFullYear()}-08-10 09:05`,
    );
  });

  it('renders a missing timestamp as empty', () => {
    expect(formatDateTime(undefined)).toBe('');
    expect(formatDateTime(0)).toBe('');
  });
});
