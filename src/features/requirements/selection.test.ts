/**
 * Unit tests for the multi-select reducer (`bun test`).
 */
import { describe, expect, it } from 'bun:test';

import {
  NO_SELECTION,
  allSelected,
  beginSelection,
  isSelected,
  pruneSelection,
  toggleAll,
  toggleSelection,
} from './selection';

describe('beginSelection', () => {
  it('enters the mode with the long-pressed row selected', () => {
    expect(beginSelection('r1')).toEqual({ active: true, ids: ['r1'] });
  });
});

describe('toggleSelection', () => {
  it('adds in pick order', () => {
    const state = toggleSelection(beginSelection('r1'), 'r2');
    expect(state.ids).toEqual(['r1', 'r2']);
  });

  it('removes without disturbing the rest', () => {
    const state = toggleSelection({ active: true, ids: ['r1', 'r2', 'r3'] }, 'r2');
    expect(state.ids).toEqual(['r1', 'r3']);
  });

  it('exits the mode when the last row is deselected', () => {
    expect(toggleSelection({ active: true, ids: ['r1'] }, 'r1')).toEqual(NO_SELECTION);
  });

  it('starts the mode when tapped while inactive', () => {
    expect(toggleSelection(NO_SELECTION, 'r1')).toEqual({ active: true, ids: ['r1'] });
  });
});

describe('toggleAll', () => {
  it('selects exactly the visible rows', () => {
    const state = toggleAll({ active: true, ids: ['r9'] }, ['r1', 'r2']);
    expect(state.ids).toEqual(['r1', 'r2']);
  });

  it('clears everything on the second press', () => {
    expect(toggleAll({ active: true, ids: ['r1', 'r2'] }, ['r1', 'r2'])).toEqual(NO_SELECTION);
  });

  it('is a no-op with nothing on screen', () => {
    const state = { active: true, ids: ['r1'] };
    expect(toggleAll(state, [])).toBe(state);
  });
});

describe('allSelected', () => {
  it('is false for an empty screen', () => {
    expect(allSelected({ active: true, ids: [] }, [])).toBe(false);
  });

  it('ignores extra selected ids that scrolled out of the page', () => {
    expect(allSelected({ active: true, ids: ['r1', 'r2', 'r3'] }, ['r1', 'r2'])).toBe(true);
  });
});

describe('pruneSelection', () => {
  it('drops ids that no longer exist', () => {
    const state = pruneSelection({ active: true, ids: ['r1', 'gone'] }, ['r1', 'r2']);
    expect(state).toEqual({ active: true, ids: ['r1'] });
  });

  it('exits the mode when nothing survives', () => {
    expect(pruneSelection({ active: true, ids: ['gone'] }, ['r1'])).toEqual(NO_SELECTION);
  });

  it('returns the same object when nothing changed (stable renders)', () => {
    const state = { active: true, ids: ['r1'] };
    expect(pruneSelection(state, ['r1', 'r2'])).toBe(state);
  });

  it('leaves an inactive state alone', () => {
    expect(pruneSelection(NO_SELECTION, [])).toBe(NO_SELECTION);
  });
});

describe('isSelected', () => {
  it('is false while the mode is off', () => {
    expect(isSelected({ active: false, ids: ['r1'] }, 'r1')).toBe(false);
  });

  it('is true for a selected row in select mode', () => {
    expect(isSelected({ active: true, ids: ['r1'] }, 'r1')).toBe(true);
  });
});
