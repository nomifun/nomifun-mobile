/**
 * Serialize preference writes while keeping "latest choice wins" semantics.
 *
 * A slow preference endpoint must not receive concurrent writes: otherwise an
 * older request can finish after a newer selection and overwrite it.  Each
 * caller can also ignore errors from superseded generations, so an old
 * failure never rolls the UI back over the user's latest choice.
 */
export class SerializedLatestWriteQueue {
  private tail: Promise<void> = Promise.resolve();
  private generation = 0;
  private pending = 0;

  get hasPending(): boolean {
    return this.pending > 0;
  }

  isLatest(generation: number): boolean {
    return generation === this.generation;
  }

  enqueue(
    operation: () => Promise<unknown>,
    callbacks: {
      onLatestSuccess?: (generation: number) => void | Promise<void>;
      onLatestError?: (error: unknown, generation: number) => void | Promise<void>;
      onLatestSettled?: (generation: number) => void | Promise<void>;
    } = {},
  ): { generation: number; done: Promise<void> } {
    const generation = ++this.generation;
    this.pending += 1;

    const run = this.tail.then(operation);
    const done = run
      .then(async () => {
        if (this.isLatest(generation)) {
          await callbacks.onLatestSuccess?.(generation);
        }
      })
      .catch(async (error: unknown) => {
        if (this.isLatest(generation)) {
          await callbacks.onLatestError?.(error, generation);
        }
      })
      .finally(async () => {
        this.pending -= 1;
        if (this.isLatest(generation)) {
          await callbacks.onLatestSettled?.(generation);
        }
      });

    // `done` consumes operation failures, allowing later writes to continue.
    this.tail = done;
    return { generation, done };
  }
}
