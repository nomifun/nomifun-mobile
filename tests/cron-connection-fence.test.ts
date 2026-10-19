import * as bunTest from 'bun:test';
import { beforeEach, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createConnectionStore } from '@/api/connection-core';
import { createDeviceIdentityStore } from '@/api/device-identity-core';
import { connectionNamespace } from '@/api/connection-contract';
import { createTransportClient, type RequestOptions } from '@/api/transport-client';
import type { AuthLoginResponse, ConnectionAuthResult, ServerBinding } from '@/api/types';
import type { CronJob } from '@/features/tasks/types';

const mockModule = (bunTest as unknown as {
  mock: { module(specifier: string, factory: () => unknown): void };
}).mock.module;

const desktop = { desktop_id: 'a', desktop_name: 'A', protocol_version: 2, min_client_protocol: 2, capabilities: ['agent_session', 'device_pairing'] };
const bindingA: ServerBinding = { baseUrl: 'https://desktop-a.test', token: 'fixture-a', user: null, desktop };
const bindingB: ServerBinding = { ...bindingA, baseUrl: 'https://desktop-b.test', token: 'fixture-b', desktop: { ...desktop, desktop_id: 'b' } };
let persist: (binding: ServerBinding) => Promise<void> = async () => undefined;
const writes: ServerBinding[] = [];
const store = createConnectionStore({ read: async () => null, write: binding => { writes.push(structuredClone(binding)); return persist(binding); } });
const data = new Map<string, string>();
let afterSet: () => void = () => undefined;
const storage = {
  getItem: async (key: string) => data.get(key) ?? null,
  setItem: async (key: string, value: string) => { data.set(key, value); afterSet(); },
  removeItem: async (key: string) => { data.delete(key); },
};
function storageKey(key: string): string {
  const binding = store.binding();
  return `${key}:${encodeURIComponent(binding ? connectionNamespace(binding) : 'unbound')}`;
}
let identitySequence = 0;
let persistIdentity = storage.setItem;
const identities = createDeviceIdentityStore({ get: storage.getItem, set: (key, value) => persistIdentity(key, value) },
  () => (++identitySequence).toString(16).padStart(64, '0'));
const requests: { url: string; authorization: string | null; key: string | null; method: string; body: Record<string, unknown> | null }[] = [];
const attempts: { path: string; expectedEpoch?: number; actualEpoch: number }[] = [];
const feedback: string[] = [];
const cacheWrites: unknown[][] = [];
let fetchResponse: (url: string, options?: RequestInit) => Promise<Response> = async () => Response.json({ success: true, data: {} });
const client = createTransportClient({ ...store, fetch: (async (url, options) => {
  const headers = new Headers(options?.headers);
  requests.push({ url: String(url), authorization: headers.get('Authorization'), key: headers.get('Idempotency-Key'), method: options?.method ?? 'GET', body: options?.body ? JSON.parse(String(options.body)) as Record<string, unknown> : null });
  return fetchResponse(String(url), options);
}) as typeof fetch });

mockModule('@react-native-async-storage/async-storage', () => ({ default: storage }));
mockModule('@/api/connection', () => ({ connectionStore: store, connectionStorageKey: storageKey }));
mockModule('@/api/device-identity', () => ({ deviceIdentityStore: identities }));
mockModule('@/api/client', () => ({ rawRequest: client.rawRequest, api: <T>(path: string, opts: RequestOptions = {}) => {
  attempts.push({ path, expectedEpoch: opts.expectedEpoch, actualEpoch: store.epoch() });
  return client.api<T>(path, opts);
} }));
mockModule('react-native', () => ({ Platform: { OS: 'ios' }, AppState: { addEventListener: () => ({ remove() {} }) } }));
mockModule('expo-device', () => ({ deviceName: 'connection-test' }));
mockModule('@/hooks/use-ws', () => ({ useWsTopic() {} }));
mockModule('@/components/ui', () => ({ toast: { success: (value: string) => feedback.push(value), error: (value: string) => feedback.push(value) } }));
mockModule('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
mockModule('swr', () => ({ default: () => ({}), useSWRConfig: () => ({ mutate: (...args: unknown[]) => { cacheWrites.push(args); return Promise.resolve(); } }) }));

const { useCronActions } = await import('@/features/tasks/hooks');
const { claimRunNow, releaseRunNow } = await import('@/features/tasks/run-now');
const { runCronJobNow } = await import('@/features/tasks/api');
const { passwordLogin, setupAdmin, devicePairLogin, probeServer, logout, refreshSessionToken } = await import('@/api/auth');
const { verifyConnection, changeConnectionRoute, revokeCurrentDevice } = await import('@/api/connections');
const { redeemConnectionPayload } = await import('@/api/pairing');
const userA = { user_id: 'owner-a', username: 'A owner' };
const system = { storage_generation: 'data-a', agent_data_generation: 1, platform: 'win32', arch: 'x64' };
const loginResponse: AuthLoginResponse = { success: true, token: 'paired-a', user: userA,
  device: { device_id: 'phone-a', device_name: 'connection-test', created_at_ms: 1, last_seen_at_ms: 1, revoked_at_ms: null } };
const qr = 'https://desktop-a.test/device-pair?token=' + 'a'.repeat(64);
function authBody(url: string) {
  if (url.endsWith('/api/connections/info')) return { success: true, data: desktop };
  if (url.endsWith('/api/system/info')) return { success: true, data: system };
  if (url.endsWith('/api/auth/status')) return { success: true, needs_setup: false };
  return loginResponse;
}
const authFlows: [string, (epoch: number) => Promise<ConnectionAuthResult>][] = [
  ['password', epoch => passwordLogin(bindingA.baseUrl, 'fixture', 'fixture', epoch)],
  ['setup', epoch => setupAdmin(bindingA.baseUrl, 'fixture', 'fixture', epoch)],
  ['pair', epoch => devicePairLogin(bindingA.baseUrl, 'a'.repeat(64), epoch)],
];
function renderActions() {
  let actions!: ReturnType<typeof useCronActions>;
  function Owner() { actions = useCronActions(); return null; }
  // Use real React hooks. The action captures the epoch of the rendered owner,
  // so retaining it after a connection commit exercises the actual UI path.
  renderToString(createElement(Owner));
  return actions;
}
function job(id: string): CronJob {
  return { cron_job_id: id, name: id, enabled: true, schedule: { kind: 'cron', expr: '' }, message: 'run', execution_mode: 'existing',
    metadata: { agent_type: 'nomi', created_by: 'user', created_at: 0, updated_at: 0 }, state: { run_count: 0, retry_count: 0, max_retries: 3 } };
}
beforeEach(async () => {
  persist = async () => undefined;
  persistIdentity = storage.setItem; identitySequence = 0;
  afterSet = () => undefined;
  data.clear(); requests.length = 0; attempts.length = 0; feedback.length = 0; cacheWrites.length = 0;
  fetchResponse = async () => Response.json({ success: true, data: {} });
  await store.connect(bindingA);
  writes.length = 0;
});

test('a target commit between the claim return and its await continuation cannot POST to B', async () => {
  const actions = renderActions();
  const epoch = store.epoch();
  let releaseCommit!: () => void;
  persist = binding => binding.baseUrl === bindingB.baseUrl ? new Promise<void>(resolve => { releaseCommit = resolve; }) : Promise.resolve();
  const changing = store.connect(bindingB, true, epoch);
  await Promise.resolve();
  // The pending B write is released by the same legal microtask schedule as
  // the review's reproduction: claim finishes, B commits, caller resumes.
  afterSet = () => queueMicrotask(releaseCommit);
  await actions.runNow(job('claim-continuation-gap'));
  await changing;
  expect(store.binding()?.desktop?.desktop_id).toBe('b');
  expect(attempts).toHaveLength(1);
  expect(attempts[0].expectedEpoch).toBe(epoch);
  expect(attempts[0].actualEpoch).toBeGreaterThan(epoch);
  expect(requests).toEqual([]);
  expect(feedback).toEqual([]);
  expect(cacheWrites).toEqual([]);
  expect([...data.keys()][0]).toContain(encodeURIComponent(connectionNamespace(bindingA)));
});

test('retained A UI callbacks invoked after B commits do no HTTP, persistence, cache or feedback work', async () => {
  const actions = renderActions();
  await store.connect(bindingB);
  const oldJob = job('retained-callback');
  await actions.runNow(oldJob);
  await actions.setEnabled(oldJob, false);
  expect(await actions.remove(oldJob)).toBe(false);
  expect(await actions.save(oldJob.cron_job_id, { name: 'new' })).toBe(null);
  expect(await actions.create({ name: 'new', schedule: oldJob.schedule, prompt: 'run', agent_type: 'nomi', created_by: 'user', execution_mode: 'existing' })).toBe(null);
  expect(requests).toEqual([]); expect(attempts).toEqual([]); expect(data.size).toBe(0);
  expect(feedback).toEqual([]); expect(cacheWrites).toEqual([]);
});

test('the production API rejects an old claim at the final transport fence', async () => {
  const epoch = store.epoch();
  const key = await claimRunNow('explicit-api-fence', epoch);
  expect(key).toBeTruthy();
  await store.connect(bindingB);
  const error = await runCronJobNow('explicit-api-fence', key!, epoch).catch(reason => reason);
  expect(error.code).toBe('CONNECTION_CHANGED'); expect(requests).toEqual([]);
  releaseRunNow('explicit-api-fence', key!);
});

test('A success retires its key; an ambiguous A failure is not replayed and a manual retry reuses it', async () => {
  const actions = renderActions();
  const target = job('success-and-retry');
  fetchResponse = async () => { throw new TypeError('response lost'); };
  await actions.runNow(target);
  expect(requests).toHaveLength(1);
  const first = requests[0];
  expect(first.url).toContain('desktop-a.test'); expect(first.authorization).toBe('Bearer fixture-a'); expect(first.key).toBeTruthy();
  expect(data.size).toBe(1);
  fetchResponse = async () => Response.json({ success: true, data: {} });
  await actions.runNow(target);
  expect(requests).toHaveLength(2); expect(requests[1].key).toBe(first.key); expect(data.size).toBe(0);
  await actions.runNow(target);
  expect(requests).toHaveLength(3); expect(requests[2].key).not.toBe(first.key);
});

test('a response lost on A keeps A namespace key while a fresh B action has its own key', async () => {
  const actionsA = renderActions();
  const target = job('namespace-retry');
  fetchResponse = async () => { throw new TypeError('response lost'); };
  await actionsA.runNow(target);
  const keyA = requests[0].key;
  await store.connect(bindingB);
  fetchResponse = async () => Response.json({ success: true, data: {} });
  await renderActions().runNow(target);
  expect(requests[1].url).toContain('desktop-b.test'); expect(requests[1].authorization).toBe('Bearer fixture-b'); expect(requests[1].key).not.toBe(keyA);
  await store.connect(bindingA);
  await renderActions().runNow(target);
  expect(requests[2].key).toBe(keyA); expect(requests[2].authorization).toBe('Bearer fixture-a');
});

test('late A receipt causes no success feedback or cache writes on B', async () => {
  const actions = renderActions();
  let release!: (response: Response) => void;
  let started!: () => void;
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  fetchResponse = () => new Promise(resolve => { release = resolve; started(); });
  const running = actions.runNow(job('late-response'));
  // A claim has two storage awaits before the request; observe its own fetch,
  // rather than guessing a number of scheduler turns.
  await requestStarted;
  await store.connect(bindingB);
  release(Response.json({ success: true, data: {} }));
  await running;
  expect(requests).toHaveLength(1); expect(requests[0].url).toContain('desktop-a.test');
  expect(feedback).toEqual([]); expect(cacheWrites).toEqual([]); expect(data.size).toBe(1);
});

for (const [name, authenticate] of authFlows) {
  test(`${name}: a microtask B commit after A metadata cannot redeem or overwrite B`, async () => {
    const epoch = store.epoch();
    let releaseCommit!: () => void;
    let armed!: () => void;
    const waiting = new Promise<void>(resolve => { armed = resolve; });
    persist = binding => {
      if (binding.desktop?.desktop_id !== 'b') return Promise.resolve();
      return new Promise<void>(resolve => { releaseCommit = resolve; armed(); });
    };
    const changing = store.connect(bindingB, true, epoch);
    await waiting;
    fetchResponse = async url => ({ ok: true, status: 200, text: async () => {
      // Reproduce the review's count=1 schedule through the actual transport,
      // not a mocked fetchDesktopInfo or auth helper.
      queueMicrotask(() => queueMicrotask(releaseCommit));
      return JSON.stringify(authBody(url));
    } }) as Response;
    const result = await authenticate(epoch).catch(error => error);
    await changing;
    expect(result.code).toBe('CONNECTION_CHANGED');
    expect(requests.filter(request => request.method === 'POST')).toEqual([]);
    expect(writes.map(binding => binding.desktop?.desktop_id)).toEqual(['b']);
    expect(store.binding()?.token).toBe('fixture-b');
    expect(store.binding()?.desktop?.desktop_id).toBe('b');
  });

  test(`${name}: a fresh intent can commit A and returns the verified A receipt`, async () => {
    fetchResponse = async url => Response.json(authBody(url));
    const initialEpoch = store.epoch();
    const receipt = await authenticate(initialEpoch);
    expect(receipt.user).toEqual(userA); expect(receipt.epoch).toBe(store.epoch());
    expect(receipt.epoch).toBe(initialEpoch + 2); // own binding plus first namespace verification
    expect(store.binding()?.token).toBe('paired-a'); expect(store.verified()).toBe(true);
    expect(requests.filter(request => request.method === 'POST')).toHaveLength(1);
  });
}

test('the manual probe-to-login continuation keeps its original intent epoch', async () => {
  fetchResponse = async url => Response.json(authBody(url));
  const epoch = store.epoch();
  expect((await probeServer(bindingA.baseUrl, epoch)).reachable).toBe(true);
  await store.connect(bindingB);
  const result = await passwordLogin(bindingA.baseUrl, 'fixture', 'fixture', epoch).catch(error => error);
  expect(result.code).toBe('CONNECTION_CHANGED');
  expect(requests).toHaveLength(1); expect(requests[0].url).toContain('/api/auth/status');
  expect(store.binding()?.token).toBe('fixture-b');
});

test('default pairing lazy-load carries the old caller epoch across its await', async () => {
  fetchResponse = async url => Response.json(authBody(url));
  const epoch = store.epoch();
  const changing = store.connect(bindingB, true, epoch);
  const pairing = redeemConnectionPayload(qr, epoch);
  await changing;
  const result = await pairing.catch(error => error);
  expect(result.code).toBe('CONNECTION_CHANGED'); expect(requests).toEqual([]);
  expect(writes.map(binding => binding.desktop?.desktop_id)).toEqual(['b']);
  expect(store.binding()?.token).toBe('fixture-b');
});

test('A credential commit never silently verifies B or returns an A success on B', async () => {
  fetchResponse = async url => Response.json(authBody(url));
  let changing: Promise<boolean> | undefined;
  persist = binding => {
    if (binding.token === 'paired-a' && !binding.system) {
      queueMicrotask(() => { changing = store.connect(bindingB); });
    }
    return Promise.resolve();
  };
  const result = await passwordLogin(bindingA.baseUrl, 'fixture', 'fixture', store.epoch()).catch(error => error);
  await changing;
  expect(result.code).toBe('CONNECTION_CHANGED');
  expect(store.binding()?.token).toBe('fixture-b');
  expect(requests.some(request => request.url.includes('desktop-b.test'))).toBe(false);
  expect(writes.map(binding => binding.desktop?.desktop_id)).toEqual(['a', 'b']);
});

test('A verification commit returns its own epoch, rejecting B before publishing the auth receipt', async () => {
  fetchResponse = async url => Response.json(authBody(url));
  let changing: Promise<boolean> | undefined;
  persist = binding => {
    if (binding.token === 'paired-a' && binding.system) {
      queueMicrotask(() => { changing = store.connect(bindingB); });
    }
    return Promise.resolve();
  };
  const result = await passwordLogin(bindingA.baseUrl, 'fixture', 'fixture', store.epoch()).catch(error => error);
  await changing;
  expect(result.code).toBe('CONNECTION_CHANGED'); expect(store.binding()?.token).toBe('fixture-b');
  expect(requests.some(request => request.url.includes('desktop-b.test'))).toBe(false);
});

test('a lost verification network retains the redeemed A credential for explicit repair without redeeming again', async () => {
  let infoRequests = 0;
  fetchResponse = async url => {
    if (url.endsWith('/api/connections/info') && ++infoRequests === 2) throw new TypeError('verification offline');
    return Response.json(authBody(url));
  };
  const result = await devicePairLogin(bindingA.baseUrl, 'a'.repeat(64), store.epoch()).catch(error => error);
  expect(result.message).toBe('verification offline');
  expect(store.binding()?.token).toBe('paired-a'); expect(store.verified()).toBe(false);
  fetchResponse = async url => Response.json(authBody(url));
  expect(await verifyConnection(store.epoch())).toBe(store.epoch()); expect(store.verified()).toBe(true);
  expect(requests.filter(request => request.method === 'POST')).toHaveLength(1);
});

test('a new same-Desktop route intent remains allowed while retained revoke and route callbacks are fenced', async () => {
  await store.connect({ ...bindingA, system, user: userA });
  fetchResponse = async url => Response.json(authBody(url));
  const initial = store.epoch();
  const alternate = 'https://desktop-a-relay.test';
  const verified = await changeConnectionRoute(alternate, 'relay', initial);
  expect(verified).toBe(store.epoch()); expect(store.binding()?.baseUrl).toBe(alternate); expect(store.verified()).toBe(true);
  const completed = requests.length;
  await store.connect(bindingB);
  expect((await changeConnectionRoute(bindingA.baseUrl, 'direct', initial).catch(error => error)).code).toBe('CONNECTION_CHANGED');
  expect((await revokeCurrentDevice(initial).catch(error => error)).code).toBe('CONNECTION_CHANGED');
  expect(requests).toHaveLength(completed); expect(store.binding()?.token).toBe('fixture-b');
});

test('a retained logout confirmation from A cannot revoke or clear B; current A logout still works', async () => {
  const epoch = store.epoch();
  // This function has the same captured owner as the native Alert callback.
  const confirmA = () => logout(epoch);
  await store.connect(bindingB);
  await confirmA();
  expect(requests).toEqual([]); expect(store.binding()?.token).toBe('fixture-b');
  await store.connect({ ...bindingA, device: loginResponse.device });
  await logout(store.epoch());
  expect(requests).toHaveLength(1); expect(requests[0].url).toContain('desktop-a.test/api/connections/device');
  expect(requests[0].method).toBe('DELETE'); expect(store.binding()).toBe(null);
});

test('a refresh continuation from A cannot publish into a new route epoch even when the JWT is identical', async () => {
  const epoch = store.epoch();
  let releaseCommit!: () => void;
  let armed!: () => void;
  const waiting = new Promise<void>(resolve => { armed = resolve; });
  persist = binding => binding.baseUrl === bindingB.baseUrl
    ? new Promise<void>(resolve => { releaseCommit = resolve; armed(); }) : Promise.resolve();
  const changing = store.connect({ ...bindingB, token: bindingA.token }, true, epoch);
  await waiting;
  fetchResponse = async () => ({ ok: true, status: 200, text: async () => {
    queueMicrotask(() => queueMicrotask(releaseCommit));
    return JSON.stringify({ success: true, token: 'refreshed-a' });
  } }) as Response;
  const result = await refreshSessionToken().catch(error => error);
  await changing;
  expect(result.code).toBe('CONNECTION_CHANGED'); expect(store.binding()?.desktop?.desktop_id).toBe('b');
  expect(store.binding()?.token).toBe(bindingA.token);
  expect(writes.map(binding => binding.desktop?.desktop_id)).toEqual(['b']);
});

test('a real old WS policy-close queued during a same-JWT route write keeps the new route credential', async () => {
  await store.connect({ ...bindingA, system });
  writes.length = 0;
  fetchResponse = async url => Response.json(authBody(url));
  let opened!: () => void;
  const firstSocket = new Promise<void>(resolve => { opened = resolve; });
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    static OPEN = 1; static CONNECTING = 0;
    readyState = 1;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: ((event: { code: number }) => void) | null = null;
    constructor(readonly url: string, readonly protocols: string[]) { sockets.push(this); opened(); }
    close() { this.readyState = 3; }
    send() {}
  }
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  const { nomifunSocket } = await import('@/api/ws');
  const originalMark = store.markAuthExpired;
  const receipts: { token: string; epoch: number }[] = [];
  store.markAuthExpired = (token, epoch) => { receipts.push({ token, epoch }); originalMark(token, epoch); };
  try {
    nomifunSocket.start();
    await firstSocket;
    const epoch = store.epoch();
    let release!: () => void;
    let armed!: () => void;
    const waiting = new Promise<void>(resolve => { armed = resolve; });
    const alternate = 'https://desktop-a-relay.test';
    persist = binding => binding.baseUrl === alternate && binding.token
      ? new Promise<void>(resolve => { release = resolve; armed(); }) : Promise.resolve();
    const changing = store.selectRoute(alternate, 'relay', epoch);
    await waiting;
    // The actual production onclose producer still belongs to the old route
    // while the new route's durable write is waiting in the serial owner.
    sockets[0].onclose?.({ code: 1008 });
    release();
    await changing;
    nomifunSocket.stop();
    persist = async () => undefined;
    await store.disconnect('not-this-credential', store.epoch());
    expect(receipts).toEqual([{ token: bindingA.token, epoch }]);
    expect(store.binding()?.baseUrl).toBe(alternate); expect(store.binding()?.token).toBe(bindingA.token);
    expect(store.getState().phase).toBe('connected'); expect(writes.every(binding => Boolean(binding.token))).toBe(true);
  } finally {
    nomifunSocket.stop(); store.markAuthExpired = originalMark; globalThis.WebSocket = originalWebSocket;
  }
});

test('a new route waiting for token renewal starts its own refresh when the old epoch releases single-flight', async () => {
  await store.connect({ ...bindingA, system });
  let releaseA!: (response: Response) => void;
  let startedA!: () => void;
  const requestAStarted = new Promise<void>(resolve => { startedA = resolve; });
  const alternate = 'https://desktop-a-relay.test';
  fetchResponse = async url => {
    if (url.endsWith('/api/auth/refresh')) {
      if (url.startsWith(bindingA.baseUrl)) return new Promise<Response>(resolve => { releaseA = resolve; startedA(); });
      return Response.json({ success: true, token: 'refreshed-new-route' });
    }
    return Response.json(authBody(url));
  };
  const sockets: FakeSocket[] = [];
  let opened!: () => void;
  const firstSocket = new Promise<void>(resolve => { opened = resolve; });
  let openedB!: () => void;
  const socketBReady = new Promise<void>(resolve => { openedB = resolve; });
  class FakeSocket {
    static OPEN = 1; static CONNECTING = 0;
    readyState = 1;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: ((event: { code: number }) => void) | null = null;
    constructor(readonly url: string, readonly protocols: string[]) {
      sockets.push(this); opened(); if (url.startsWith('wss://desktop-a-relay.test')) openedB();
    }
    close() { this.readyState = 3; }
    send() {}
  }
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  const { nomifunSocket } = await import('@/api/ws');
  try {
    nomifunSocket.start(); await firstSocket;
    sockets[0].onclose?.({ code: 4409 });
    await requestAStarted;
    await store.selectRoute(alternate, 'relay', store.epoch());
    await socketBReady;
    sockets[1].onclose?.({ code: 4409 });
    expect(requests.filter(request => request.url.endsWith('/api/auth/refresh'))).toHaveLength(1);
    releaseA(Response.json({ success: true, token: 'stale-old-route-token' }));
    // Both HTTP replies and all durable writes are immediate promises. One
    // event-loop turn drains their continuations and any scheduled 0ms timer.
    await new Promise(resolve => setTimeout(resolve, 0));
    const refreshes = requests.filter(request => request.url.endsWith('/api/auth/refresh'));
    expect(refreshes).toHaveLength(2);
    expect(refreshes[0].url).toBe(`${bindingA.baseUrl}/api/auth/refresh`);
    expect(refreshes[1].url).toBe(`${alternate}/api/auth/refresh`);
    expect(store.binding()?.baseUrl).toBe(alternate); expect(store.binding()?.token).toBe('refreshed-new-route');
    expect(store.verified()).toBe(true);
    expect(sockets[sockets.length - 1].protocols).toEqual(['refreshed-new-route']);
    expect(writes.some(binding => binding.token === 'stale-old-route-token')).toBe(false);
  } finally {
    nomifunSocket.stop(); globalThis.WebSocket = originalWebSocket;
  }
});

for (const [name, authenticate] of authFlows) {
  test(`${name} registers stable installation identity with only a same-Desktop device proof`, async () => {
    fetchResponse = async url => Response.json(authBody(url));
    await store.connect({ ...bindingA, device: loginResponse.device });
    await authenticate(store.epoch());
    const own = requests.find(request => request.method === 'POST')!;
    expect(own.body?.protocol_version).toBe(2);
    expect(own.body?.installation_key).toMatch(/^[0-9a-f]{64}$/);
    expect(own.body?.previous_device_token).toBe(bindingA.token);
    expect(own.authorization).toBe(null);
    requests.length = 0;
    await store.connect({ ...bindingB, device: loginResponse.device });
    await authenticate(store.epoch());
    const foreign = requests.find(request => request.method === 'POST')!;
    expect(foreign.body?.installation_key).toBe(own.body?.installation_key);
    expect(foreign.body).not.toHaveProperty('previous_device_token');
    expect(foreign.authorization).toBe(null);
  });

  test(`${name} cannot register after installation-key storage fails or its connection intent expires`, async () => {
    fetchResponse = async url => Response.json(authBody(url));
    persistIdentity = async () => { throw new Error('Identity write failed'); };
    expect((await authenticate(store.epoch()).catch(error => error)).message).toBe('Identity write failed');
    expect(requests.some(request => request.method === 'POST')).toBe(false);
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>(resolve => { started = resolve; });
    persistIdentity = (key, value) => new Promise<void>(resolve => {
      release = () => { data.set(key, value); resolve(); }; started();
    });
    const operation = authenticate(store.epoch()).catch(error => error);
    await waiting;
    await store.connect(bindingB);
    release();
    expect((await operation).code).toBe('CONNECTION_CHANGED');
    expect(requests.some(request => request.method === 'POST')).toBe(false);
    expect(store.binding()?.token).toBe(bindingB.token);
  });
}

test('forgotten bindings and failed credential commits preserve the independently durable installation identity', async () => {
  fetchResponse = async url => Response.json(authBody(url));
  persist = async binding => { if (binding.token === 'paired-a') throw new Error('Credential write failed'); };
  expect((await passwordLogin(bindingA.baseUrl, 'fixture', 'fixture', store.epoch()).catch(error => error)).message).toBe('Credential write failed');
  const first = requests.find(request => request.method === 'POST')!.body?.installation_key;
  persist = async () => undefined;
  await store.disconnect(undefined, store.epoch());
  await passwordLogin(bindingA.baseUrl, 'fixture', 'fixture', store.epoch());
  const registrations = requests.filter(request => request.method === 'POST');
  expect(registrations).toHaveLength(2);
  expect(registrations[1].body?.installation_key).toBe(first);
  expect(identitySequence).toBe(1);
});
