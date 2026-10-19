/**
 * Real Mobile Session transport, commands, owner and wire validation against a
 * separately started Desktop HTTP host. No React Native imports or model calls.
 *
 * bun e2e/sessions-contract.mts --backend-url http://127.0.0.1:<port> --data-dir <isolated-data-dir>
 * The host must use a fresh directory under the system temp directory or this
 * repository's .tmp-e2e/. Its reported data_dir must match before Session writes.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createTransportClient } from '../src/api/transport-client';
import { ApiError, type AuthLoginResponse, type AuthStatusResponse, type ServerBinding } from '../src/api/types';
import type { Conversation, ConversationListOptions, SessionReadOptions } from '../src/features/sessions/api';
import { createConversationCommand } from '../src/features/sessions/commands';
import { createSessionData, type SessionData, type SessionMetadataUpdate } from '../src/features/sessions/data';
import { conversationListResponse, conversationResponse } from '../src/features/sessions/wire';

const { values } = parseArgs({ options: {
  'backend-url': { type: 'string' }, 'data-dir': { type: 'string' },
  report: { type: 'string' }, help: { type: 'boolean' },
} });
if (values.help) {
  console.log('bun e2e/sessions-contract.mts --backend-url http://127.0.0.1:<port> --data-dir <isolated-data-dir> [--report <path>]');
  process.exit(0);
}
assert.ok(values['backend-url'] && values['data-dir'], 'Supply the URL and data directory of a separate, fresh test installation.');
const baseUrl = new URL(values['backend-url']);
assert.equal(baseUrl.protocol, 'http:');
assert.equal(baseUrl.hostname, '127.0.0.1');
assert.equal(baseUrl.pathname, '/');
assert.equal(baseUrl.username + baseUrl.password + baseUrl.search + baseUrl.hash, '');
const dataDir = await realpath(resolve(values['data-dir']));
const repoRoot = resolve(import.meta.dirname, '..');
const tempRoots = process.platform === 'win32' ? [tmpdir()] : [tmpdir(), '/tmp'];
const isolatedRoots = [...await Promise.all(tempRoots.map(path => realpath(path))), resolve(repoRoot, '.tmp-e2e')];
assert.ok(isolatedRoots.some(root => {
  const path = relative(root, dataDir);
  return path !== '' && !path.startsWith('..') && !isAbsolute(path);
}), 'The test data directory must be isolated under the system temp directory or .tmp-e2e/.');
const announced = JSON.parse((await readFile(join(dataDir, 'port.json'), 'utf8')).replace(/^\uFEFF/, '')) as {
  host: string; port: number; pid: number;
};
assert.equal(announced.host, '127.0.0.1');
assert.equal(Number(baseUrl.port), announced.port);
assert.ok(Number.isInteger(announced.pid) && announced.pid > 0);
const reportPath = resolve(values.report ?? join(repoRoot, '.tmp-e2e/session-data/report.json'));
const requests: Array<{ method: string; path: string; status?: number }> = [];
const report = {
  schema: 'nomifun.mobile-session-contract.v1', generated_at: new Date().toISOString(),
  backend_url: baseUrl.origin, backend_pid: announced.pid, data_dir: dataDir,
  scope: 'Real Mobile HTTP transport, shared creation command, Session data owner and wire validators; no model or Turn execution.',
  checks: [] as string[], created_ids: [] as string[], requests,
  passed: false, cleanup_passed: true, failure: undefined as string | undefined,
  failed_check: undefined as string | undefined,
  failure_code: undefined as string | undefined,
  failure_status: undefined as number | undefined,
  cleanup_failures: [] as Array<{ id: string; message: string; code?: string; status?: number }>,
};
const epoch = 1;
let binding: ServerBinding = { baseUrl: baseUrl.origin, token: '', user: null };
const transport = createTransportClient({
  binding: () => binding, epoch: () => epoch, verified: () => true,
  markAuthExpired: () => { throw new Error('The isolated test device credential was rejected'); },
  fetch: (async (url, options) => {
    const target = new URL(String(url));
    assert.equal(target.origin, baseUrl.origin, 'Every Mobile request must stay on the isolated backend');
    const entry = { method: options?.method ?? 'GET', path: target.pathname, status: undefined as number | undefined };
    requests.push(entry);
    const response = await fetch(url, options);
    entry.status = response.status;
    return response;
  }) as typeof fetch,
});
const sessionPath = (id: string) => `/api/agent-sessions/${encodeURIComponent(id)}`;
const readPage = async ({ cursor, signal, expectedEpoch }: ConversationListOptions) => {
  const query = new URLSearchParams({ limit: '2' });
  if (cursor) query.set('cursor', cursor);
  return conversationListResponse(await transport.api<unknown>(`/api/agent-sessions?${query}`, { signal, expectedEpoch }));
};
const readOne = async (id: string, options: SessionReadOptions = {}) => conversationResponse(
  await transport.api<unknown>(`${sessionPath(id)}/projection`, options), 'conversation', id,
);
const patch = async (id: string, updates: SessionMetadataUpdate, options: SessionReadOptions) => conversationResponse(
  await transport.api<unknown>(sessionPath(id), { ...options, method: 'PATCH', body: updates }), 'conversation', id,
);
const remove = (id: string, options: SessionReadOptions = {}) => transport.api<unknown>(sessionPath(id), { ...options, method: 'DELETE' });
const ownedIds = new Set<string>();
let owner: SessionData | undefined;
const subscriptions: Array<() => void> = [];

async function check(name: string, action: () => Promise<void>) {
  try { await action(); }
  catch (error) { report.failed_check = name; throw error; }
  report.checks.push(name);
  console.log(`PASS ${name}`);
}

function until(data: SessionData, condition: () => boolean, label: string): Promise<void> {
  return new Promise((accept, reject) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for ${label}`));
    }, 20_000);
    const inspect = () => {
      try {
        if (!condition()) return;
        clearTimeout(timer); unsubscribe(); accept();
      } catch (error) {
        clearTimeout(timer); unsubscribe(); reject(error);
      }
    };
    unsubscribe = data.subscribe(inspect);
    inspect();
  });
}

try {
  await check('loopback announcement, isolated identity and fresh provider-free installation', async () => {
    const status = await transport.rawRequest<AuthStatusResponse>('/api/auth/status');
    if (!status.is_authenticated || status.needs_setup) {
      const login = await transport.rawRequest<AuthLoginResponse>(status.needs_setup ? '/api/auth/device-setup' : '/api/auth/device-login', {
        token: '', body: { username: 'mobile-session-contract', password: 'MobileSession-2026-fixture!',
          device_name: 'Mobile Session contract', protocol_version: 1 },
      });
      assert.equal(login.success, true);
      assert.ok(login.token && login.device?.device_id);
      binding = { ...binding, token: login.token, user: login.user ?? null };
    }
    const identity = await transport.api<{ data_dir: string; storage_generation: string; agent_data_generation: number }>('/api/system/info');
    assert.equal(await realpath(identity.data_dir), dataDir, 'Refusing Session writes against a different installation');
    assert.ok(identity.storage_generation);
    assert.ok(Number.isInteger(identity.agent_data_generation));
    assert.deepEqual(await transport.api<unknown[]>('/api/providers'), [], 'Use a fresh fixture with no model providers');
  });

  owner = createSessionData({
    epoch, currentEpoch: () => epoch, fetchPage: readPage, fetchOne: readOne,
    create: createConversationCommand(transport.api, () => epoch), patch, remove,
    setModel: async (id, selection, options) => conversationResponse(await transport.api<unknown>(`${sessionPath(id)}/model`, {
      ...options, method: 'PUT', body: { provider_id: selection.providerId, model: selection.model },
    }), 'conversation', id),
  });
  const data = owner;
  await check('a real empty list settles without an empty/loading-more contradiction', async () => {
    await data.refresh();
    const snapshot = data.getSnapshot();
    assert.equal(snapshot.error, undefined);
    assert.deepEqual(snapshot.items, []);
    assert.equal(snapshot.total, 0);
    assert.equal(snapshot.isLoading, false);
    assert.equal(snapshot.isLoadingMore, false);
    assert.equal(snapshot.hasMore, false);
  });

  await check('the shared creation command returns committed IDs and refresh preserves every created Session', async () => {
    for (let index = 0; index < 3; index += 1) {
      const receipt = await data.create(`Mobile Session contract ${index + 1}`);
      assert.equal(receipt.epoch, epoch);
      assert.ok(receipt.conversation_id);
      ownedIds.add(receipt.conversation_id);
      report.created_ids.push(receipt.conversation_id);
      await until(data, () => data.getSnapshot().items.some(item => item.conversation_id === receipt.conversation_id), 'created Session projection');
      await data.refresh();
      assert.equal(data.getSnapshot().error, undefined);
      assert.ok(data.getSnapshot().items.some(item => item.conversation_id === receipt.conversation_id));
      assert.equal((await readOne(receipt.conversation_id)).conversation_id, receipt.conversation_id);
    }
    assert.equal(new Set(report.created_ids).size, 3);
  });

  await check('real cursor pagination loads exactly three unique Sessions through a two-row window', async () => {
    await data.refresh();
    assert.equal(data.getSnapshot().items.length, 2);
    assert.equal(data.getSnapshot().total, 3);
    assert.equal(data.getSnapshot().hasMore, true);
    await data.loadMore();
    const snapshot = data.getSnapshot();
    assert.equal(snapshot.error, undefined);
    assert.equal(snapshot.items.length, 3);
    assert.equal(snapshot.hasMore, false);
    assert.equal(snapshot.isLoadingMore, false);
    assert.deepEqual(new Set(snapshot.items.map(item => item.conversation_id)), new Set(report.created_ids));
  });

  const selected = report.created_ids[2]!;
  let readerA: Conversation | undefined;
  let readerB: Conversation | undefined;
  subscriptions.push(data.subscribe(() => { readerA = data.getSnapshot().entities[selected]; }));
  subscriptions.push(data.subscribe(() => { readerB = data.getSnapshot().entities[selected]; }));
  await check('rename and pin publish the validated canonical row to list and all detail readers', async () => {
    const stop = data.watchDetail(selected);
    await until(data, () => data.getSnapshot().details[selected]?.loading === false, 'active detail read');
    await data.patch(selected, { name: 'Renamed canonical Session', pinned: true });
    assert.equal(readerA?.name, 'Renamed canonical Session');
    assert.equal(readerA?.pinned, true);
    assert.equal(readerA, readerB);
    assert.equal(data.getSnapshot().items.find(item => item.conversation_id === selected), readerA);
    const canonical = await readOne(selected);
    assert.equal(canonical.name, readerA?.name);
    assert.equal(canonical.pinned, true);
    await data.refresh();
    assert.equal(data.getSnapshot().entities[selected]?.name, canonical.name);
    assert.equal(data.getSnapshot().entities[selected]?.pinned, true);
    stop();
  });

  await check('committed deletion disappears from every reader and remains absent after refresh', async () => {
    await data.remove(selected);
    ownedIds.delete(selected);
    assert.equal(readerA, undefined);
    assert.equal(readerB, undefined);
    assert.equal(data.getSnapshot().entities[selected], undefined);
    assert.ok(!data.getSnapshot().items.some(item => item.conversation_id === selected));
    await data.refresh();
    assert.equal(data.getSnapshot().total, 2);
    assert.ok(!data.getSnapshot().items.some(item => item.conversation_id === selected));
    await assert.rejects(() => readOne(selected), (error: unknown) => error instanceof ApiError && error.status === 404);
  });

  await check('the acceptance used no model providers, Turns, warmups or execution requests', async () => {
    assert.deepEqual(await transport.api<unknown[]>('/api/providers'), []);
    assert.ok(!requests.some(request => /\/(turns|warmup|execution)(\/|$)/.test(request.path)));
    assert.ok(requests.filter(request => request.method === 'POST' && request.path === '/api/agent-sessions').length === 3);
  });
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  if (error instanceof ApiError) { report.failure_code = error.code; report.failure_status = error.status; }
  process.exitCode = 1;
  console.error(report.failure);
} finally {
  for (const unsubscribe of subscriptions) unsubscribe();
  owner?.dispose();
  for (const id of ownedIds) {
    try { await remove(id, { expectedEpoch: epoch }); }
    catch (error) {
      report.cleanup_passed = false; report.passed = false; process.exitCode = 1;
      report.cleanup_failures.push({ id, message: error instanceof Error ? error.message : String(error),
        ...(error instanceof ApiError ? { code: error.code, status: error.status } : {}),
      });
      report.failure ??= `Created Session cleanup failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`Report: ${reportPath}`);
}
