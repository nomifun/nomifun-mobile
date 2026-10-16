import { describe, expect, test } from 'bun:test';

import { shouldSubmitOnEnter } from '../src/utils/keyboard';

describe('chat keyboard submission', () => {
  test('submits an ordinary Enter', () => {
    expect(shouldSubmitOnEnter({ key: 'Enter' })).toBe(true);
  });

  test('keeps Shift + Enter as a newline', () => {
    expect(shouldSubmitOnEnter({ key: 'Enter', shiftKey: true })).toBe(false);
  });

  test('never submits while confirming an IME candidate', () => {
    expect(shouldSubmitOnEnter({ key: 'Enter', isComposing: true })).toBe(false);
    expect(shouldSubmitOnEnter({ key: 'Enter', keyCode: 229 })).toBe(false);
  });

  test('ignores other keys', () => {
    expect(shouldSubmitOnEnter({ key: 'a' })).toBe(false);
  });
});
