import { describe, expect, test } from 'bun:test';

import { SerializedLatestWriteQueue } from './serialized-latest-write-queue';

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('SerializedLatestWriteQueue', () => {
  test('serializes rapid writes in user-operation order', async () => {
    const queue = new SerializedLatestWriteQueue();
    const first = deferred();
    const second = deferred();
    const started: string[] = [];

    const firstWrite = queue.enqueue(async () => {
      started.push('A');
      await first.promise;
    });
    const secondWrite = queue.enqueue(async () => {
      started.push('B');
      await second.promise;
    });

    await flushMicrotasks();
    expect(started).toEqual(['A']);
    expect(queue.hasPending).toBe(true);

    first.resolve();
    await firstWrite.done;
    await flushMicrotasks();
    expect(started).toEqual(['A', 'B']);

    second.resolve();
    await secondWrite.done;
    expect(queue.hasPending).toBe(false);
  });

  test('only reports a failure from the latest generation', async () => {
    const queue = new SerializedLatestWriteQueue();
    const first = deferred();
    const second = deferred();
    const failures: string[] = [];

    const firstWrite = queue.enqueue(() => first.promise, {
      onLatestError: () => {
        failures.push('A');
      },
    });
    const secondWrite = queue.enqueue(() => second.promise, {
      onLatestError: () => {
        failures.push('B');
      },
    });

    first.reject(new Error('old failure'));
    await firstWrite.done;
    expect(failures).toEqual([]);

    second.reject(new Error('latest failure'));
    await secondWrite.done;
    expect(failures).toEqual(['B']);
  });
});
