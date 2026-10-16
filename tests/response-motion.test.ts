import { describe, expect, test } from 'bun:test';
import {
  advanceTextReveal,
  createTextBuffer,
  initialTextReveal,
  markdownNodeKey,
  type TextReveal,
} from '../src/components/codevisual/response-motion';

const contentOf = (state: TextReveal) =>
  state.text.slice(0, state.settled) + state.runs.map((run) => run.text).join('');

describe('AI response reveal', () => {
  test('history renders immediately without replay', () => {
    const state = initialTextReveal('A completed answer', false, 0);
    expect(state.settled).toBe(state.text.length);
    expect(state.runs).toEqual([]);
    expect(contentOf(state)).toBe(state.text);
  });

  test('appended chunks retain identities and do not fade the settled prefix again', () => {
    const first = initialTextReveal('Hello', true, 0);
    const next = advanceTextReveal(first, 'Hello there', true, 40, 250);
    expect(next.runs[0]).toBe(first.runs[0]);
    expect(next.runs[1].text).toBe(' there');
    const settled = advanceTextReveal(next, 'Hello there!', true, 300, 250);
    expect(settled.settled).toBe('Hello there'.length);
    expect(settled.runs.map((run) => run.text)).toEqual(['!']);
    expect(contentOf(settled)).toBe('Hello there!');
  });

  test('completion flushes pending fades and keeps the exact final text', () => {
    const first = initialTextReveal('Partial', true, 0);
    const final = advanceTextReveal(first, 'Final **answer**', false, 80, 250);
    expect(final.runs).toEqual([]);
    expect(contentOf(final)).toBe('Final **answer**');
  });

  test('authoritative replacement or shortening never retains stale fragments', () => {
    const first = initialTextReveal('The previous answer', true, 0);
    for (const text of ['The corrected answer', 'The', '']) {
      const next = advanceTextReveal(first, text, true, 40, 250);
      expect(next.runs).toEqual([]);
      expect(contentOf(next)).toBe(text);
    }
  });

  test('reduced motion flushes unchanged active fragments', () => {
    const first = initialTextReveal('Read me', true, 0);
    const next = advanceTextReveal(first, first.text, false, 40, 250);
    expect(next.runs).toEqual([]);
    expect(contentOf(next)).toBe(first.text);
  });

  test('unchanged active text does not restart animation', () => {
    const first = initialTextReveal('Stable', true, 0);
    expect(advanceTextReveal(first, first.text, true, 40, 250)).toBe(first);
  });

  test('long high-frequency output has bounded animation nodes and loses no characters', () => {
    let state = initialTextReveal('', true, 0);
    for (let index = 1; index <= 1000; index += 1) {
      state = advanceTextReveal(state, `${state.text}中文 👩🏽‍💻 é\n`, true, index, 250);
      expect(state.runs.length).toBeLessThanOrEqual(6);
      expect(contentOf(state)).toBe(state.text);
    }
  });
});

describe('Markdown identity', () => {
  test('keys depend on structure, not the parser random key or changing text', () => {
    const parents = [{ type: 'paragraph', index: 2 }, { type: 'body' }];
    const first = { type: 'text', index: 0, key: 'random-a', content: 'Hello' };
    const next = { ...first, key: 'random-b', content: 'Hello world' };
    expect(markdownNodeKey(first, parents)).toBe(markdownNodeKey(next, parents));
  });

  test('different siblings and node types retain separate keys', () => {
    const parents = [{ type: 'paragraph', index: 0 }, { type: 'body' }];
    const first = markdownNodeKey({ type: 'text', index: 0 }, parents);
    expect(markdownNodeKey({ type: 'text', index: 1 }, parents)).not.toBe(first);
    expect(markdownNodeKey({ type: 'strong', index: 0 }, parents)).not.toBe(first);
  });
});

function fakeClock() {
  const callbacks = new Map<ReturnType<typeof setTimeout>, () => void>();
  const delays: number[] = [];
  let sequence = 0;
  return {
    callbacks,
    delays,
    schedule(callback: () => void, delay: number) {
      const timer = sequence++ as unknown as ReturnType<typeof setTimeout>;
      callbacks.set(timer, callback);
      delays.push(delay);
      return timer;
    },
    cancel(timer: ReturnType<typeof setTimeout>) {
      callbacks.delete(timer);
    },
    tick() {
      for (const [timer, callback] of [...callbacks]) {
        callbacks.delete(timer);
        callback();
      }
    },
  };
}

describe('response paint buffer', () => {
  test('coalesces a burst without resetting the deadline or losing the latest chunk', () => {
    const clock = fakeClock();
    const values: string[] = [];
    const buffer = createTextBuffer((text) => values.push(text), 40, clock.schedule, clock.cancel);
    buffer.push('H', false);
    buffer.push('Hello', false);
    buffer.push('Hello world', false);
    expect(clock.delays).toEqual([40]);
    expect(values).toEqual([]);
    clock.tick();
    expect(values).toEqual(['Hello world']);
    buffer.push('Hello world!', false);
    clock.tick();
    expect(values).toEqual(['Hello world', 'Hello world!']);
  });

  test('completion supersedes a pending batch immediately', () => {
    const clock = fakeClock();
    const values: string[] = [];
    const buffer = createTextBuffer((text) => values.push(text), 40, clock.schedule, clock.cancel);
    buffer.push('Partial', false);
    buffer.push('Final answer', true);
    expect(values).toEqual(['Final answer']);
    expect(clock.callbacks.size).toBe(0);
    clock.tick();
    expect(values).toEqual(['Final answer']);
  });

  test('a replacement cannot later be overwritten by an older pending delta', () => {
    const clock = fakeClock();
    const values: string[] = [];
    const buffer = createTextBuffer((text) => values.push(text), 40, clock.schedule, clock.cancel);
    buffer.push('Old content', false);
    buffer.push('Corrected content', true);
    clock.tick();
    expect(values).toEqual(['Corrected content']);
  });

  test('unmount cancels a pending timer, including timer identity zero', () => {
    const clock = fakeClock();
    const values: string[] = [];
    const buffer = createTextBuffer((text) => values.push(text), 40, clock.schedule, clock.cancel);
    buffer.push('Pending', false);
    buffer.clear();
    clock.tick();
    expect(clock.callbacks.size).toBe(0);
    expect(values).toEqual([]);
  });
});
