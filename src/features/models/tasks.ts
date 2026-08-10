/**
 * Pure helpers for editing a catalog row's task tags (模态能力).
 *
 * `POST /api/provider-models/update` accepts `tasks` (and `traits`) as plain
 * optional fields — absent = keep, an array = replace — and the server stamps
 * `source: 'user'` whenever either is present, so a user edit stops being
 * overwritten by the name heuristic. Since migration 015 retired the separate
 * `model_profiles` table, that same row is what `POST /api/model-profiles/resolve`
 * reads, so this edit really does decide which selectors the model appears in.
 *
 * A row with an EMPTY task list belongs to no modality and is invisible in every
 * picker, which is why the editor refuses to save one (`canSaveTasks`).
 *
 * No React, no I/O.
 */
import { MODEL_TASK_ORDER, type ModelTask } from './types';

/** Canonical display/wire order (the desktop editors use the same one). */
export function sortTasks(tasks: readonly ModelTask[]): ModelTask[] {
  return MODEL_TASK_ORDER.filter((task) => tasks.includes(task));
}

/** Toggle one task, keeping the canonical order and dropping duplicates. */
export function toggleTask(tasks: readonly ModelTask[], task: ModelTask): ModelTask[] {
  return tasks.includes(task)
    ? sortTasks(tasks.filter((item) => item !== task))
    : sortTasks([...tasks, task]);
}

/** Order-insensitive comparison, so an untouched sheet has nothing to save. */
export function sameTasks(a: readonly ModelTask[], b: readonly ModelTask[]): boolean {
  if (a.length !== b.length) return false;
  const left = sortTasks(a);
  const right = sortTasks(b);
  return left.every((task, index) => task === right[index]);
}

/**
 * Saving is allowed only for a non-empty set that differs from the stored one.
 * Emptying the list would hide the model from every selector — deleting the row
 * is the honest way to do that, so it is not offered here.
 */
export function canSaveTasks(
  draft: readonly ModelTask[],
  stored: readonly ModelTask[],
): boolean {
  return draft.length > 0 && !sameTasks(draft, stored);
}

/**
 * Body for the update call. Exactly three fields: the natural key plus the new
 * task list — the DTO is `deny_unknown_fields`, and every other column must
 * stay absent so it keeps its stored value.
 */
export function buildTasksUpdateBody(
  providerId: string,
  model: string,
  tasks: readonly ModelTask[],
): { provider_id: string; model: string; tasks: ModelTask[] } {
  return { provider_id: providerId, model, tasks: sortTasks(tasks) };
}
