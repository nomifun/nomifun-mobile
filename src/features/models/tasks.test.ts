/**
 * Unit tests for the task-tag editor helpers (`bun test`).
 */
import { describe, expect, it } from 'bun:test';

import { buildTasksUpdateBody, canSaveTasks, sameTasks, sortTasks, toggleTask } from './tasks';
import type { ModelTask } from './types';

describe('sortTasks', () => {
  it('puts tasks in the canonical order and drops unknown duplicates', () => {
    const tasks: ModelTask[] = ['embedding', 'chat', 'chat'];
    expect(sortTasks(tasks)).toEqual(['chat', 'embedding']);
  });
});

describe('toggleTask', () => {
  it('adds in canonical order, not tap order', () => {
    expect(toggleTask(['embedding'], 'chat')).toEqual(['chat', 'embedding']);
  });

  it('removes an already-selected task', () => {
    expect(toggleTask(['chat', 'embedding'], 'chat')).toEqual(['embedding']);
  });

  it('can empty the list (the editor, not this helper, forbids saving that)', () => {
    expect(toggleTask(['chat'], 'chat')).toEqual([]);
  });

  it('never mutates the input', () => {
    const tasks: ModelTask[] = ['chat'];
    toggleTask(tasks, 'rerank');
    expect(tasks).toEqual(['chat']);
  });
});

describe('sameTasks', () => {
  it('ignores order', () => {
    expect(sameTasks(['chat', 'embedding'], ['embedding', 'chat'])).toBe(true);
  });

  it('detects a different length or member', () => {
    expect(sameTasks(['chat'], ['chat', 'embedding'])).toBe(false);
    expect(sameTasks(['chat'], ['rerank'])).toBe(false);
  });
});

describe('canSaveTasks', () => {
  it('refuses an empty selection', () => {
    expect(canSaveTasks([], ['chat'])).toBe(false);
  });

  it('refuses an unchanged selection', () => {
    expect(canSaveTasks(['chat'], ['chat'])).toBe(false);
  });

  it('allows a real change', () => {
    expect(canSaveTasks(['chat', 'embedding'], ['chat'])).toBe(true);
  });

  it('allows tagging a row that had no tasks at all', () => {
    expect(canSaveTasks(['chat'], [])).toBe(true);
  });
});

describe('buildTasksUpdateBody', () => {
  it('sends only the natural key plus the sorted tasks', () => {
    const body = buildTasksUpdateBody('p1', 'gpt-4o', ['embedding', 'chat']);
    expect(body).toEqual({ provider_id: 'p1', model: 'gpt-4o', tasks: ['chat', 'embedding'] });
    expect(Object.keys(body).sort()).toEqual(['model', 'provider_id', 'tasks']);
  });
});
