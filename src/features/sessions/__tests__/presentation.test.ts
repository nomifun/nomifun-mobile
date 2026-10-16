import { describe, expect, test } from 'bun:test';
import type { Conversation } from '../api';
import { filterConversations } from '../presentation';

const session = (id: string, patch: Partial<Conversation> = {}): Conversation => ({
  conversation_id: id,
  name: id,
  type: 'nomi',
  created_at: 1,
  modified_at: 1,
  ...patch,
});
const items = [
  session('plain'),
  session('project', { extra: { workspace: '/work/mobile' } }),
  session('temporary', { extra: { workspace: '/tmp/work', is_temporary_workspace: true } }),
  session('companion', { extra: { workspace: '/companions/one', companion_session: 1 } }),
  session('pinned', { pinned: true, model: { model: 'Example Model' } }),
];

describe('conversation inbox scope', () => {
  test('all retains source order and items', () =>
    expect(filterConversations(items, '', 'all')).toEqual(items));
  test('pinned uses the server flag', () =>
    expect(filterConversations(items, '', 'pinned').map((item) => item.conversation_id)).toEqual([
      'pinned',
    ]));
  test('projects excludes temporary and companion workspaces', () =>
    expect(filterConversations(items, '', 'projects').map((item) => item.conversation_id)).toEqual([
      'project',
    ]));
  test('companions follows the canonical numeric or boolean flag', () =>
    expect(
      filterConversations(items, '', 'companions').map((item) => item.conversation_id),
    ).toEqual(['companion']));
  test('matches model and workspace without losing scope', () => {
    expect(filterConversations(items, ' EXAMPLE ', 'pinned')).toHaveLength(1);
    expect(filterConversations(items, '/work/mobile', 'projects')).toHaveLength(1);
    expect(filterConversations(items, 'project', 'companions')).toHaveLength(0);
  });
  test('does not mutate the loaded snapshot', () => {
    filterConversations(items, 'plain', 'all');
    expect(items).toHaveLength(5);
    expect(items[0]?.conversation_id).toBe('plain');
  });
});
