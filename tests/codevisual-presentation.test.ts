import { describe, expect, test } from 'bun:test';
import { filterPaletteGroups, nextCommandIndex } from '../src/components/codevisual/command-data';
import { partitionBoard } from '../src/components/codevisual/board-data';

describe('CodeVisual command projection', () => {
  const groups = [
    {
      label: 'Actions',
      items: [
        { label: 'New Project', id: 'project' },
        { label: 'Settings', id: 'settings' },
      ],
    },
    { label: 'Recent', items: [{ label: 'Project Mobile', id: 'recent' }] },
  ];
  test('empty input retains groups and order', () =>
    expect(filterPaletteGroups(groups, ' ')).toEqual(groups));
  test('matches every query term independent of case', () =>
    expect(filterPaletteGroups(groups, ' NEW  project ')[0]?.items.map((item) => item.id)).toEqual([
      'project',
    ]));
  test('drops empty groups and does not mutate the source', () => {
    expect(filterPaletteGroups(groups, 'mobile').map((group) => group.label)).toEqual(['Recent']);
    expect(groups[0]?.items).toHaveLength(2);
  });
  test('handles no matches', () => expect(filterPaletteGroups(groups, 'missing')).toEqual([]));
  test('cycles in either direction', () => {
    expect(nextCommandIndex(2, 1, 3)).toBe(0);
    expect(nextCommandIndex(0, -1, 3)).toBe(2);
  });
  test('empty results never create an invalid index', () =>
    expect(nextCommandIndex(0, -1, 0)).toBe(0));
});

describe('CodeVisual board projection', () => {
  const lanes = [
    { key: 'pending', title: 'Pending' },
    { key: 'done', title: 'Done' },
  ];
  const items = [
    { id: 'one', status: 'done' },
    { id: 'two', status: 'pending' },
    { id: 'three', status: 'done' },
  ];
  test('partitions each loaded item without changing its status or order', () => {
    const board = partitionBoard(items, lanes, (item) => item.status);
    expect(board.map((lane) => lane.items.map((item) => item.id))).toEqual([
      ['two'],
      ['one', 'three'],
    ]);
    expect(board.flatMap((lane) => lane.items)).toHaveLength(items.length);
    expect(items.map((item) => item.status)).toEqual(['done', 'pending', 'done']);
  });
  test('retains empty lanes', () =>
    expect(partitionBoard([], lanes, () => 'pending').map((lane) => lane.items)).toEqual([[], []]));
  test('projects only requested lanes', () =>
    expect(partitionBoard(items, [lanes[0]!], (item) => item.status)[0]?.items).toHaveLength(1));
});
