/**
 * Frequency presets for the create/edit form.
 *
 * These emit exactly the same **6-field, seconds-first** expressions the
 * desktop dialog produces (`ui/src/renderer/pages/cron/ScheduledTasksPage`),
 * so a task created on the phone is indistinguishable from a desktop one.
 */
export type FrequencyPreset = 'manual' | 'hourly' | 'daily9' | 'weekdays9' | 'weeklyMon9' | 'custom';

export const PRESET_ORDER: FrequencyPreset[] = [
  'daily9',
  'hourly',
  'weekdays9',
  'weeklyMon9',
  'manual',
  'custom',
];

export const PRESET_EXPRESSIONS: Record<Exclude<FrequencyPreset, 'custom'>, string> = {
  /** No schedule at all — the task can only be triggered with "Run now". */
  manual: '',
  hourly: '0 0 * * * ?',
  daily9: '0 0 9 * * ?',
  weekdays9: '0 0 9 ? * MON-FRI',
  weeklyMon9: '0 0 9 ? * MON',
};

/** Reverse lookup so edit mode preselects the right pill (else `custom`). */
export function presetForExpression(expr: string): FrequencyPreset {
  const normalized = expr.trim().replace(/\s+/g, ' ').toUpperCase();
  if (!normalized) return 'manual';
  for (const [preset, value] of Object.entries(PRESET_EXPRESSIONS)) {
    if (value && value.toUpperCase() === normalized) return preset as FrequencyPreset;
  }
  return 'custom';
}
