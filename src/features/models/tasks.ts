/**
 * Compatibility helpers kept for callers/tests that still import `tasks.ts`.
 * New writes use the complete nested capability save endpoint.
 */
import { MODEL_TASK_ORDER, type ModelTask } from './types';

export function sortTasks(tasks: readonly ModelTask[]): ModelTask[] {
  return MODEL_TASK_ORDER.filter((task) => tasks.includes(task));
}

export function toggleTask(tasks: readonly ModelTask[], task: ModelTask): ModelTask[] {
  return tasks.includes(task)
    ? sortTasks(tasks.filter((item) => item !== task))
    : sortTasks([...tasks, task]);
}

export function sameTasks(a: readonly ModelTask[], b: readonly ModelTask[]): boolean {
  if (a.length !== b.length) return false;
  const left = sortTasks(a);
  const right = sortTasks(b);
  return left.every((task, index) => task === right[index]);
}

export function canSaveTasks(
  draft: readonly ModelTask[],
  stored: readonly ModelTask[],
): boolean {
  return draft.length > 0 && !sameTasks(draft, stored);
}

/** Legacy test helper only; production code must not send this body. */
export function buildTasksUpdateBody(
  providerId: string,
  model: string,
  tasks: readonly ModelTask[],
): { provider_id: string; model: string; tasks: ModelTask[] } {
  return { provider_id: providerId, model, tasks: sortTasks(tasks) };
}
