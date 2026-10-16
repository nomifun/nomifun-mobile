import { describe, expect, test } from 'bun:test';
import type { SendMessageResult } from '../api';
import { cancelObservedTurn } from '../turn-cancel';

describe('exact turn cancellation', () => {
  test('keeps the observed target when a successor starts before cancellation settles', async () => {
    let active = 'turn-a';
    const targets: string[] = [];
    const stopping = cancelObservedTurn(active, null, async (target) => {
      active = 'turn-b';
      targets.push(target);
    });
    await stopping;
    expect(active).toBe('turn-b');
    expect(targets).toEqual(['turn-a']);
  });

  test('waits for the exact pending acceptance when turn.started has not arrived', async () => {
    let accept!: (receipt: SendMessageResult) => void;
    const acceptance = new Promise<SendMessageResult>((resolve) => { accept = resolve; });
    const targets: string[] = [];
    const stopping = cancelObservedTurn(null, acceptance, async (target) => { targets.push(target); });
    expect(targets).toEqual([]);
    accept({ msg_id: 'accepted-input-a', completed: false });
    expect(await stopping).toBe(true);
    expect(targets).toEqual(['accepted-input-a']);
  });

  test('a completed receipt and a missing identity never send a broad cancellation', async () => {
    const targets: string[] = [];
    const cancel = async (target: string) => { targets.push(target); };
    expect(await cancelObservedTurn(null, Promise.resolve({ msg_id: 'turn-a', completed: true }), cancel)).toBe(true);
    expect(await cancelObservedTurn(null, null, cancel)).toBe(false);
    expect(targets).toEqual([]);
  });
});
