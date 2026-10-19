import { describe, expect, it } from 'bun:test';
import { ApiError, AuthExpiredError, StaleConnectionError } from '@/api/types';
import type { Conversation, Paginated, SessionReadOptions } from '@/features/sessions/api';
import type { CreatedConversation } from '@/features/sessions/commands';
import { createSessionData, type SessionDataOptions } from '@/features/sessions/data';

const row = (id: string, patch: Partial<Conversation> = {}): Conversation => ({
  conversation_id: id, name: id, type: 'nomi', created_at: 1, modified_at: 1, ...patch,
});
const page = (items: Conversation[] = []): Paginated<Conversation> => ({ items, total: items.length, has_more: false });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 15; i += 1) await Promise.resolve(); };

function fixture(initial: Conversation[] = []) {
  let epoch = 7;
  let rows = initial;
  const deps: SessionDataOptions = {
    epoch, currentEpoch: () => epoch,
    fetchPage: async () => page(rows),
    fetchOne: async id => {
      const found = rows.find(value => value.conversation_id === id);
      if (!found) throw new Error('No such Session');
      return found;
    },
    create: async () => {
      rows = [row('created'), ...rows];
      return { conversation_id: 'created', epoch };
    },
    patch: async (id, patch) => {
      const updated = row(id, { ...rows.find(value => value.conversation_id === id), ...patch });
      rows = rows.map(value => value.conversation_id === id ? updated : value);
      return updated;
    },
    remove: async id => { rows = rows.filter(value => value.conversation_id !== id); },
    setModel: async (id, selection) => {
      const updated = row(id, { ...rows.find(value => value.conversation_id === id), model: {
        provider_id: selection.providerId, model: selection.model,
      } });
      rows = rows.map(value => value.conversation_id === id ? updated : value);
      return updated;
    },
  };
  const data = createSessionData(deps);
  return { data, deps, setEpoch: (next: number) => { epoch = next; }, setRows: (next: Conversation[]) => { rows = next; } };
}

describe('connection-owned Session data', () => {
  it('publishes detail reads into the same entities without inventing list membership', async () => {
    const client = fixture([row('listed')]);
    await client.data.refresh();
    client.deps.fetchOne = async id => row(id, { name: 'Detail projection' });
    await client.data.reloadDetail('detail-only');
    const snapshot = client.data.getSnapshot();
    expect(snapshot.items.map(item => item.conversation_id)).toEqual(['listed']);
    expect(snapshot.entities['detail-only']?.name).toBe('Detail projection');
    expect(Object.getPrototypeOf(snapshot)).toBe(null);
    expect(Object.getPrototypeOf(snapshot.details)).toBe(null);
    expect(Object.getPrototypeOf(snapshot.entities)).toBe(null);
    client.data.dispose();
  });

  it('resolves creation at the POST receipt even when both subsequent reads fail', async () => {
    const client = fixture();
    const projectionFailure = new Error('Projection unavailable');
    const listFailure = new Error('List unavailable');
    client.deps.fetchOne = async () => { throw projectionFailure; };
    client.deps.fetchPage = async () => { throw listFailure; };
    expect(await client.data.create('Created')).toEqual({ conversation_id: 'created', epoch: 7 });
    await flush();
    expect(client.data.getSnapshot().creating).toBe(false);
    expect(client.data.getSnapshot().details.created?.error).toBe(projectionFailure);
    expect(client.data.getSnapshot().error).toBe(listFailure);
    // A later successful read retains the already-committed creation intent.
    client.deps.fetchOne = async id => row(id);
    await client.data.reloadDetail('created');
    expect(client.data.getSnapshot().items.map(item => item.conversation_id)).toEqual(['created']);
    client.data.dispose();
  });

  it('retains one idempotency key across uncertain retries and separates changed intents', async () => {
    const client = fixture();
    const requests: { key: string; workspace?: string; epoch: number }[] = [];
    let loseReceipt = true;
    client.deps.create = async (_name, options) => {
      requests.push({ key: options.idempotencyKey, workspace: options.workspace, epoch: options.expectedEpoch });
      if (loseReceipt) throw new TypeError('Lost receipt after POST');
      return { conversation_id: 'created', epoch: 7 };
    };
    await client.data.create('Same', { workspace: ' /project ' }).catch(() => undefined);
    await client.data.create('Changed', { workspace: '/project' }).catch(() => undefined);
    loseReceipt = false;
    await client.data.create('Same', { workspace: '/project' });
    expect(requests[0]?.key).toBe(requests[2]?.key);
    expect(requests[1]?.key).not.toBe(requests[0]?.key);
    expect(requests.every(request => request.workspace === '/project' && request.epoch === 7)).toBe(true);
    client.data.dispose();
  });

  it('shares a concurrent identical creation and refuses to merge a different intent', async () => {
    const client = fixture();
    const receipt = deferred<CreatedConversation>();
    let calls = 0;
    client.deps.create = async () => { calls += 1; return receipt.promise; };
    const first = client.data.create('One');
    const same = client.data.create('One');
    const changed = client.data.create('Two').catch(error => error);
    expect(same).toBe(first);
    expect(await changed).toBeInstanceOf(ApiError);
    expect((await changed).code).toBe('SESSION_CREATION_BUSY');
    expect(client.data.getSnapshot().creating).toBe(true);
    receipt.resolve({ conversation_id: 'created', epoch: 7 });
    await first;
    expect(calls).toBe(1);
    client.data.dispose();
  });

  it('reuses creation projection loading across navigation and preserves list membership', async () => {
    const client = fixture();
    const projection = deferred<Conversation>();
    let reads = 0;
    client.deps.fetchPage = async () => { throw new Error('List temporarily unavailable'); };
    client.deps.fetchOne = async () => { reads += 1; return projection.promise; };
    await client.data.create('Created');
    const stop = client.data.watchDetail('created');
    await flush();
    expect(reads).toBe(1);
    stop();
    projection.resolve(row('created'));
    await flush();
    expect(client.data.getSnapshot().items.map(item => item.conversation_id)).toEqual(['created']);
    client.data.dispose();
  });

  it('prevents a late detail GET from overwriting committed metadata', async () => {
    const client = fixture([row('session')]);
    await client.data.refresh();
    const oldRead = deferred<Conversation>();
    let signal: AbortSignal | undefined;
    client.deps.fetchOne = async (_id, options) => { signal = options.signal; return oldRead.promise; };
    const reading = client.data.reloadDetail('session');
    await flush();
    await client.data.patch('session', { name: 'Committed name', pinned: true });
    oldRead.resolve(row('session', { name: 'Old name' }));
    expect(await reading).toBeUndefined();
    expect(signal?.aborted).toBe(true);
    await flush();
    expect(client.data.getSnapshot().entities.session?.name).toBe('Committed name');
    expect(client.data.getSnapshot().items[0]?.name).toBe('Committed name');
    client.data.dispose();
  });

  it('prevents an obsolete detail GET from resurrecting a committed deletion', async () => {
    const client = fixture([row('session')]);
    await client.data.refresh();
    const oldRead = deferred<Conversation>();
    client.deps.fetchOne = async () => oldRead.promise;
    const reading = client.data.reloadDetail('session');
    await flush();
    await client.data.remove('session');
    oldRead.resolve(row('session'));
    await reading;
    await flush();
    expect(client.data.getSnapshot().entities.session).toBeUndefined();
    expect(client.data.getSnapshot().items).toEqual([]);
    client.data.dispose();
  });

  it('serializes mutations for the same Session and publishes one cache to every consumer', async () => {
    const client = fixture([row('session')]);
    await client.data.refresh();
    const patched = deferred<Conversation>();
    const commands: string[] = [];
    client.deps.patch = async () => { commands.push('patch'); return patched.promise; };
    client.deps.remove = async () => { commands.push('remove'); client.setRows([]); };
    let consumerA: Conversation | undefined;
    let consumerB: Conversation | undefined;
    const unsubscribeA = client.data.subscribe(() => { consumerA = client.data.getSnapshot().entities.session; });
    const unsubscribeB = client.data.subscribe(() => { consumerB = client.data.getSnapshot().entities.session; });
    const patching = client.data.patch('session', { name: 'Committed' });
    const removing = client.data.remove('session');
    await flush();
    expect(commands).toEqual(['patch']);
    const committed = row('session', { name: 'Committed' });
    client.setRows([committed]);
    patched.resolve(committed);
    await patching;
    await removing;
    await flush();
    expect(commands).toEqual(['patch', 'remove']);
    expect(consumerA).toBeUndefined();
    expect(consumerB).toBe(consumerA);
    unsubscribeA(); unsubscribeB(); client.data.dispose();
  });

  it('updates the shared row after a committed model selection', async () => {
    const client = fixture([row('session')]);
    await client.data.refresh();
    await client.data.setModel('session', { providerId: 'provider', model: 'model-b' });
    expect(client.data.getSnapshot().entities.session?.model).toEqual({ provider_id: 'provider', model: 'model-b' });
    expect(client.data.getSnapshot().items[0]).toBe(client.data.getSnapshot().entities.session);
    client.data.dispose();
  });

  it('keeps a rejected model selection local to its caller and accepts a later selection', async () => {
    const client = fixture([row('session', { model: null, runtime: { can_send_message: true } })]);
    await client.data.refresh();
    await client.data.reloadDetail('session');
    const before = client.data.getSnapshot();
    const failure = new ApiError('Model selection refused', 409, 'CONFLICT');
    const commitModel = client.deps.setModel;
    client.deps.setModel = async () => { throw failure; };

    expect(await client.data.setModel('session', { providerId: 'provider', model: 'model-a' }).catch(error => error)).toBe(failure);
    expect(client.data.getSnapshot()).toBe(before);
    expect(client.data.getSnapshot().details.session?.error).toBeUndefined();
    expect(client.data.getSnapshot().entities.session?.model).toBeNull();

    client.deps.setModel = commitModel;
    await client.data.setModel('session', { providerId: 'provider', model: 'model-b' });
    expect(client.data.getSnapshot().entities.session?.model).toEqual({ provider_id: 'provider', model: 'model-b' });
    client.data.dispose();
  });

  it('preserves an existing detail read failure when a command is rejected', async () => {
    const client = fixture([row('session')]);
    await client.data.refresh();
    const readFailure = new Error('Detail read unavailable');
    client.deps.fetchOne = async () => { throw readFailure; };
    await client.data.reloadDetail('session');
    const before = client.data.getSnapshot();
    const commandFailure = new ApiError('Model selection refused', 409, 'CONFLICT');
    client.deps.setModel = async () => { throw commandFailure; };

    expect(await client.data.setModel('session', { providerId: 'provider', model: 'model-b' }).catch(error => error)).toBe(commandFailure);
    expect(client.data.getSnapshot()).toBe(before);
    expect(client.data.getSnapshot().details.session?.error).toBe(readFailure);
    client.data.dispose();
  });

  it('lets an in-flight detail read finish after a command is rejected', async () => {
    const client = fixture([row('session')]);
    await client.data.refresh();
    const response = deferred<Conversation>();
    let signal: AbortSignal | undefined;
    client.deps.fetchOne = async (_id, options) => { signal = options.signal; return response.promise; };
    const reading = client.data.reloadDetail('session');
    await flush();
    const before = client.data.getSnapshot();
    const failure = new ApiError('Model selection refused', 409, 'CONFLICT');
    client.deps.setModel = async () => { throw failure; };

    expect(await client.data.setModel('session', { providerId: 'provider', model: 'model-b' }).catch(error => error)).toBe(failure);
    expect(client.data.getSnapshot()).toBe(before);
    expect(client.data.getSnapshot().details.session?.loading).toBe(true);
    expect(signal?.aborted).toBe(false);

    const canonical = row('session', { name: 'Latest projection' });
    response.resolve(canonical);
    expect(await reading).toBe(canonical);
    expect(client.data.getSnapshot().entities.session).toBe(canonical);
    expect(client.data.getSnapshot().details.session).toEqual({ loading: false, error: undefined });
    client.data.dispose();
  });

  it('propagates authentication and stale-connection command failures without changing detail state', async () => {
    for (const failure of [new AuthExpiredError(), new StaleConnectionError()]) {
      const client = fixture([row('session')]);
      await client.data.refresh();
      await client.data.reloadDetail('session');
      const before = client.data.getSnapshot();
      client.deps.setModel = async () => { throw failure; };

      expect(await client.data.setModel('session', { providerId: 'provider', model: 'model-b' }).catch(error => error)).toBe(failure);
      expect(client.data.getSnapshot()).toBe(before);
      client.data.dispose();
    }
  });

  it('reconciles the list and exactly the active detail subscriptions', async () => {
    const client = fixture([row('__proto__'), row('active'), row('inactive')]);
    await client.data.refresh();
    const reads: string[] = [];
    const requests: SessionReadOptions[] = [];
    client.deps.fetchOne = async (id, options) => { reads.push(id); requests.push(options); return row(id); };
    const one = client.data.watchDetail('__proto__');
    const duplicate = client.data.watchDetail('__proto__');
    const two = client.data.watchDetail('active');
    await flush();
    expect(reads).toEqual(['__proto__', 'active']);
    duplicate();
    client.data.reconcile();
    await flush();
    expect(reads).toEqual(['__proto__', 'active', '__proto__', 'active']);
    expect(requests.every(request => request.expectedEpoch === 7)).toBe(true);
    expect(client.data.getSnapshot().details.__proto__?.error).toBeUndefined();
    expect(client.data.getSnapshot().entities.__proto__?.conversation_id).toBe('__proto__');
    one(); two(); client.data.dispose();
  });

  it('cancels a no-longer-watched ordinary read without publishing its late result', async () => {
    const client = fixture();
    const response = deferred<Conversation>();
    let signal: AbortSignal | undefined;
    client.deps.fetchOne = async (_id, options) => { signal = options.signal; return response.promise; };
    const stop = client.data.watchDetail('session');
    await flush();
    stop(); stop();
    expect(signal?.aborted).toBe(true);
    response.resolve(row('session'));
    await flush();
    expect(client.data.getSnapshot().entities.session).toBeUndefined();
    expect(client.data.getSnapshot().details.session?.loading).toBe(false);
    client.data.dispose();
  });

  it('fences every in-flight creation, detail, metadata, and model continuation on a connection change', async () => {
    for (const operation of ['create', 'detail', 'patch', 'setModel'] as const) {
      const client = fixture([row('session')]);
      await client.data.refresh();
      const result = deferred<Conversation>();
      const created = deferred<CreatedConversation>();
      client.deps.fetchOne = async () => result.promise;
      client.deps.patch = async () => result.promise;
      client.deps.create = async () => created.promise;
      let observed: SessionReadOptions | undefined;
      if (operation === 'patch') client.deps.patch = async (_id, _updates, request) => { observed = request; return result.promise; };
      if (operation === 'setModel') client.deps.setModel = async (_id, _selection, request) => { observed = request; return result.promise; };
      const pending = operation === 'create' ? client.data.create('Created') : operation === 'detail'
        ? client.data.reloadDetail('session') : operation === 'patch'
          ? client.data.patch('session', { name: 'New' })
          : client.data.setModel('session', { providerId: 'provider', model: 'model-b' });
      const settled = pending.catch(error => error);
      await flush();
      const before = client.data.getSnapshot();
      client.setEpoch(8);
      result.resolve(row('session', { name: 'Old server result' }));
      created.resolve({ conversation_id: 'created', epoch: 7 });
      const value = await settled;
      if (operation !== 'detail') expect(value).toBeInstanceOf(StaleConnectionError);
      else expect(value).toBeUndefined();
      expect(client.data.getSnapshot()).toBe(before);
      if (observed) expect(observed.expectedEpoch).toBe(7);
      expect(await client.data.create('Late').catch(error => error)).toBeInstanceOf(StaleConnectionError);
      client.data.dispose();
    }
  });

  it('stores failed background detail reads and suppresses disposed continuations', async () => {
    const client = fixture();
    const failure = new Error('Detail request failed');
    client.deps.fetchOne = async () => { throw failure; };
    client.data.watchDetail('session');
    await flush();
    expect(client.data.getSnapshot().details.session?.error).toBe(failure);
    const response = deferred<Conversation>();
    client.deps.fetchOne = async () => response.promise;
    const reading = client.data.reloadDetail('session');
    await flush();
    const before = client.data.getSnapshot();
    client.data.dispose();
    response.resolve(row('session'));
    await reading;
    expect(client.data.getSnapshot()).toBe(before);
  });
});
