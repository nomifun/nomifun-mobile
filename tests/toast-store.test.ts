import { afterEach, describe, expect, test } from 'bun:test';

import { toast, toastStore } from '../src/components/ui/toast-store';

afterEach(() => {
  for (const item of toastStore.snapshot()) toastStore.dismiss(item.id);
});

describe('toast feedback', () => {
  test('dismisses one item without removing another', () => {
    toast.info('first');
    toast.error('second');
    const [first, second] = toastStore.snapshot();
    toastStore.dismiss(first.id);
    expect(toastStore.snapshot()).toEqual([second]);
  });

  test('caps feedback at three items', () => {
    for (const text of ['one', 'two', 'three', 'four']) toast.success(text);
    expect(toastStore.snapshot().map((item) => item.text)).toEqual(['two', 'three', 'four']);
  });

  test('notifies subscribers only for real changes and supports cleanup', () => {
    let calls = 0;
    const unsubscribe = toastStore.subscribe(() => {
      calls += 1;
    });
    toast.info('notice');
    const item = toastStore.snapshot()[0];
    toastStore.dismiss(-1);
    expect(calls).toBe(1);
    toastStore.dismiss(item.id);
    expect(calls).toBe(2);
    unsubscribe();
    toast.info('unobserved');
    expect(calls).toBe(2);
  });
});
