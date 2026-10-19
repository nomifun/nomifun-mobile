import { describe, expect, it } from 'bun:test';
import type { Conversation } from '@/features/sessions/api';
import { reconcileRuntimeSnapshot, type ReconciledRuntime } from '@/features/sessions/runtime-recovery';

const snapshot = (runtime: Conversation['runtime']): Conversation => ({
  conversation_id: 'session', name: 'Session', type: 'nomi', created_at: 1, modified_at: 1, runtime,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture() {
  let generation = 1;
  let current = true;
  let state: ReconciledRuntime = { activeTurnId: 'missed-completion', streaming: true, canSend: false, sawCompletion: false };
  const completedTurnIds = new Set<string>();
  const changes: ReconciledRuntime[] = [];
  return {
    get state() { return state; },
    changes,
    completedTurnIds,
    nextTurn(id: string) {
      generation += 1;
      state = { activeTurnId: id, streaming: true, canSend: false, sawCompletion: false };
    },
    completeTurn(id: string) {
      generation += 1;
      completedTurnIds.add(id);
      state = { activeTurnId: null, streaming: false, canSend: true, sawCompletion: true };
    },
    switchConnection() { current = false; },
    recover(read: () => Promise<Conversation | undefined>, acceptance?: Promise<unknown>) {
      return reconcileRuntimeSnapshot({ read, acceptance, generation: () => generation, isCurrent: () => current,
        completedTurnIds, apply: runtime => { state = runtime; changes.push(runtime); } });
    },
  };
}

describe('chat runtime recovery from the provider delivery-gap barrier', () => {
  it('unlocks a missed completion after a short foreground resume without requiring a socket reconnect', async () => {
    const chat = fixture();
    const foregroundRead = deferred<Conversation>();
    const recovering = chat.recover(() => foregroundRead.promise);
    // No speculative unlock while the fresh foreground snapshot is pending.
    expect(chat.state.activeTurnId).toBe('missed-completion');
    expect(chat.state.canSend).toBe(false);
    foregroundRead.resolve(snapshot({ is_processing: false, can_send_message: true, active_turn_id: null }));
    expect(await recovering).toBe(true);
    expect(chat.state).toEqual({ activeTurnId: null, streaming: false, canSend: true, sawCompletion: true });
  });

  it('a turn.started received after a recovery read began fences its old idle result', async () => {
    const chat = fixture();
    const oldSnapshot = deferred<Conversation>();
    const recovering = chat.recover(() => oldSnapshot.promise);
    chat.nextTurn('new-exact-turn');
    oldSnapshot.resolve(snapshot({ is_processing: false, can_send_message: true }));
    expect(await recovering).toBe(false);
    expect(chat.state).toEqual({ activeTurnId: 'new-exact-turn', streaming: true, canSend: false, sawCompletion: false });
    expect(chat.changes).toEqual([]);
  });

  it('a completion received during recovery cannot be reopened by an old running snapshot', async () => {
    const chat = fixture();
    const oldSnapshot = deferred<Conversation>();
    const recovering = chat.recover(() => oldSnapshot.promise);
    chat.completeTurn('missed-completion');
    oldSnapshot.resolve(snapshot({ is_processing: true, active_turn_id: 'missed-completion', can_send_message: false }));
    expect(await recovering).toBe(false);
    expect(chat.state.canSend).toBe(true);
    expect(chat.state.streaming).toBe(false);
    expect(chat.changes).toEqual([]);
  });

  it('an event preceding a delayed recovery effect is retained until its fresh snapshot confirms the current turn', async () => {
    const chat = fixture();
    chat.nextTurn('arrived-before-effect');
    const fresh = deferred<Conversation>();
    const recovering = chat.recover(() => fresh.promise);
    expect(chat.state.activeTurnId).toBe('arrived-before-effect');
    fresh.resolve(snapshot({ is_processing: true, active_turn_id: 'arrived-before-effect', can_send_message: false }));
    expect(await recovering).toBe(true);
    expect(chat.state.activeTurnId).toBe('arrived-before-effect');
    expect(chat.state.canSend).toBe(false);
  });

  it('an old connection result or a failed projection never unlocks the current runtime', async () => {
    const chat = fixture();
    const oldSnapshot = deferred<Conversation>();
    const recovering = chat.recover(() => oldSnapshot.promise);
    chat.switchConnection();
    oldSnapshot.resolve(snapshot({ is_processing: false, can_send_message: true }));
    expect(await recovering).toBe(false);
    expect(chat.changes).toEqual([]);
    const offline = fixture();
    expect(await offline.recover(async () => { throw new Error('Projection offline'); })).toBe(false);
    expect(offline.state.canSend).toBe(false);
  });

  it('waits for the pending input acceptance before reading whether the runtime is idle', async () => {
    const chat = fixture();
    const acceptance = deferred<unknown>();
    let reads = 0;
    const recovering = chat.recover(async () => {
      reads += 1;
      return snapshot({ is_processing: true, active_turn_id: 'accepted-turn', can_send_message: false });
    }, acceptance.promise);
    expect(reads).toBe(0);
    acceptance.resolve({ message_id: 'accepted-turn' });
    expect(await recovering).toBe(true);
    expect(reads).toBe(1);
    expect(chat.state.activeTurnId).toBe('accepted-turn');
    expect(chat.state.canSend).toBe(false);
  });

  it('does not begin an obsolete snapshot if a newer turn arrives while acceptance is pending', async () => {
    const chat = fixture();
    const acceptance = deferred<unknown>();
    let reads = 0;
    const recovering = chat.recover(async () => { reads += 1; return snapshot({ is_processing: false }); }, acceptance.promise);
    chat.nextTurn('started-before-acceptance-settled');
    acceptance.resolve({});
    expect(await recovering).toBe(false);
    expect(reads).toBe(0);
    expect(chat.state.canSend).toBe(false);
  });

  it('retains an already completed exact turn fence across recovery', async () => {
    const chat = fixture();
    chat.completedTurnIds.add('known-completed');
    expect(await chat.recover(async () => snapshot({ is_processing: true, active_turn_id: 'known-completed' }))).toBe(true);
    expect(chat.state).toEqual({ activeTurnId: null, streaming: false, canSend: true, sawCompletion: true });
  });
});
