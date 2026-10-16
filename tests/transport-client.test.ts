import { expect, test } from 'bun:test';
import { createConnectionStore } from '@/api/connection-core';
import { createTransportClient } from '@/api/transport-client';
const binding = { baseUrl: 'https://desktop-a.test', token: 'a', user: { user_id: 'u', username: 'U' } };
const storeFactory = () => createConnectionStore({ read: async () => null, write: async () => undefined });

test('explicit address discovery never sends an existing Desktop credential', async () => {
  const store = storeFactory(); await store.connect(binding);
  let authorization: string | null = 'unset';
  const client = createTransportClient({ ...store, fetch: (async (_url, options) => {
    authorization = new Headers(options?.headers).get('Authorization'); return Response.json({ success: true, data: 'public' });
  }) as typeof fetch });
  expect(await client.api('/api/connections/info', { baseUrl: 'https://other.test' })).toBe('public');
  expect(authorization).toBe(null);
});
test('late HTTP body from an old connection cannot enter the new cache', async () => {
  const store = storeFactory(); await store.connect(binding);
  let release!: (response: Response) => void;
  const client = createTransportClient({ ...store, fetch: (() => new Promise(resolve => { release = resolve; })) as typeof fetch });
  const response = client.api('/api/agent-sessions');
  await store.connect({ ...binding, baseUrl: 'https://b.test', token: 'b' });
  release(Response.json({ success: true, data: [{ conversation_id: 'a' }] }));
  expect(await response.catch(error => error.code)).toBe('CONNECTION_CHANGED');
});
test('ambiguous POST failure is delivered once and never replayed by transport', async () => {
  const store = storeFactory(); await store.connect(binding); let calls = 0;
  const client = createTransportClient({ ...store, fetch: (async () => { calls++; throw new TypeError('response lost'); }) as typeof fetch });
  await client.api('/api/agent-sessions/a/turns', { body: { input: 'run', idempotency_key: 'same' } }).catch(() => undefined);
  expect(calls).toBe(1);
});
test('revocation clears only the matching credential; ordinary forbidden does not log out', async () => {
  const store = storeFactory(); await store.connect(binding);
  let rejected = false;
  const client = createTransportClient({ ...store, fetch: (async () => Response.json(rejected
    ? { code: 'UNAUTHORIZED', error: 'Invalid device credential' } : { code: 'FORBIDDEN', error: 'Not allowed' }, { status: rejected ? 401 : 403 })) as typeof fetch });
  await client.api('/api/test').catch(() => undefined); expect(store.binding()?.token).toBe('a');
  rejected = true; await client.api('/api/test').catch(() => undefined);
  await new Promise(resolve => setTimeout(resolve, 0)); expect(store.binding()).toBe(null);
});
test('H5 transport refuses cross-site addresses before fetching', async () => {
  const store = storeFactory(); let calls = 0;
  const client = createTransportClient({ ...store, sameOrigin: true, fetch: (async () => { calls++; return Response.json({}); }) as typeof fetch });
  expect(await client.api('/api/auth/device-pair', { baseUrl: 'https://remote.test', body: {} }).catch(error => error.code)).toBe('PAIRING_ORIGIN_MISMATCH');
  expect(calls).toBe(0);
});
test('body parsing and multi-request operation fences both reject another generation', async () => {
  const store = storeFactory(); await store.connect(binding); const epoch = store.epoch();
  let release!: (text: string) => void; let started!: () => void;
  const bodyStarted = new Promise<void>(resolve => { started = resolve; });
  let calls = 0;
  const client = createTransportClient({ ...store, fetch: (async () => {
    calls++; return { status: 200, ok: true, text: () => { started(); return new Promise(resolve => { release = resolve; }); } } as Response;
  }) as typeof fetch });
  const response = client.api('/api/agent-sessions'); await bodyStarted;
  await store.connect({ ...binding, token: 'b' }); release('{"success":true,"data":[]}');
  expect(await response.catch(error => error.code)).toBe('CONNECTION_CHANGED');
  expect(await client.api('/api/agent-sessions', { body: {}, expectedEpoch: epoch }).catch(error => error.code)).toBe('CONNECTION_CHANGED');
  expect(calls).toBe(1);
});
test('machine device revocation clears credentials on both business 403 and refresh 401', async () => {
  for (const status of [403, 401]) {
    const store = storeFactory(); await store.connect(binding);
    const client = createTransportClient({ ...store, fetch: (async () => Response.json(
      { success: false, code: 'DEVICE_REVOKED', error: 'Authorization was removed' }, { status })) as typeof fetch });
    expect(await client.api('/api/system/info').catch(error => error.name)).toBe('AuthExpiredError');
    await new Promise(resolve => setTimeout(resolve, 0)); expect(store.binding()).toBe(null);
  }
});
test('blocked identity prevents business requests from sending a saved token', async () => {
  const store = storeFactory(); await store.connect(binding); let calls = 0;
  const client = createTransportClient({ ...store, verified: () => { const state = store.getState(); return state.phase === 'connected' && state.verified; },
    fetch: (async () => { calls++; return Response.json({ success: true, data: 'public' }); }) as typeof fetch });
  await store.block(store.epoch());
  expect(await client.api('/api/agent-sessions').catch(error => error.code)).toBe('DESKTOP_IDENTITY_UNAVAILABLE');
  expect(calls).toBe(0);
  expect(await client.api('/api/connections/info', { baseUrl: '', token: '' })).toBe('public');
});

test('an accepted A auth-expiry receipt queued behind a same-JWT route commit cannot clear the new route', async () => {
  for (let count = 0; count < 5; count++) {
    const writes: { baseUrl: string; token: string }[] = [];
    let release!: () => void;
    let armed!: () => void;
    const waiting = new Promise<void>(resolve => { armed = resolve; });
    const alternate = 'https://desktop-a-relay.test';
    const store = createConnectionStore({ read: async () => null, write: async next => {
      writes.push({ baseUrl: next.baseUrl, token: next.token });
      if (next.baseUrl === alternate && next.token) await new Promise<void>(resolve => { release = resolve; armed(); });
    } });
    await store.connect(binding);
    const epoch = store.epoch();
    const changing = store.selectRoute(alternate, 'relay', epoch);
    await waiting;
    const receipts: { token: string; epoch: number }[] = [];
    const client = createTransportClient({ ...store, markAuthExpired: (token, ownerEpoch) => {
      receipts.push({ token, epoch: ownerEpoch }); store.markAuthExpired(token, ownerEpoch);
    }, fetch: (async () => ({ ok: false, status: 401, text: async () => {
      let remaining = count;
      const tick = () => remaining-- > 0 ? queueMicrotask(tick) : release();
      queueMicrotask(tick);
      return JSON.stringify({ code: 'UNAUTHORIZED', error: 'Invalid or expired token' });
    } }) as Response) as typeof fetch });
    expect(await client.rawRequest('/api/auth/user', { expectedEpoch: epoch }).catch(error => error.name)).toBe('AuthExpiredError');
    await changing;
    // Drain the actual serialized owner behind its queued clear without
    // mutating this binding. Merely waiting for the route promise is too weak.
    await store.disconnect('not-this-credential', store.epoch());
    expect(receipts).toEqual([{ token: binding.token, epoch }]);
    expect(store.getState().phase).toBe('connected'); expect(store.binding()?.baseUrl).toBe(alternate);
    expect(store.binding()?.token).toBe(binding.token);
    expect(writes).toEqual([{ baseUrl: binding.baseUrl, token: binding.token }, { baseUrl: alternate, token: binding.token }]);
  }
});
