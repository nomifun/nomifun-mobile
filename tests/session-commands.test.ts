import { describe, expect, it } from 'bun:test';
import { createTransportClient, type RequestOptions } from '@/api/transport-client';
import { ApiError, AuthExpiredError, StaleConnectionError } from '@/api/types';
import { createConversationCommand, type SessionRequest } from '@/features/sessions/commands';

const TEMPLATES = '/api/agent-preset-templates?source=official';
const PRESET = '/api/agent-presets/from-template/assistant.general';
const CREATE = '/api/agent-sessions';

function fixture() {
  let epoch = 7;
  let launchPreset = 'preset-a';
  const requests: { path: string; method: string; key: string | null; body: unknown }[] = [];
  const attempts: { path: string; expectedEpoch?: number }[] = [];
  const payload = (path: string): unknown => {
    if (path === TEMPLATES) return { official_templates: [{ template_key: 'assistant.general', seed: { required_resource_kinds: ['workspace'] } }] };
    if (path === PRESET) return { preset: { preset_id: launchPreset } };
    if (path === CREATE) return { agent_session_id: 'session-created' };
    throw new Error(`Unexpected request: ${path}`);
  };
  let respond = async (path: string): Promise<Response> => Response.json({ success: true, data: payload(path) });
  const transport = createTransportClient({
    binding: () => null, epoch: () => epoch, markAuthExpired() {}, sameOrigin: true,
    fetch: (async (url, input) => {
      const path = String(url);
      requests.push({ path, method: input?.method ?? 'GET', key: new Headers(input?.headers).get('Idempotency-Key'),
        body: input?.body ? JSON.parse(String(input.body)) : undefined });
      return respond(path);
    }) as typeof fetch,
  });
  let afterRead = (_path: string) => {};
  const request: SessionRequest = async <T>(path: string, options?: RequestOptions): Promise<T> => {
    attempts.push({ path, expectedEpoch: options?.expectedEpoch });
    const result = await transport.api<T>(path, options);
    afterRead(path);
    return result;
  };
  return {
    requests, attempts, payload, command: createConversationCommand(request, () => epoch),
    options: { expectedEpoch: epoch, idempotencyKey: 'same-user-intent' },
    setEpoch: (next: number) => { epoch = next; },
    setLaunchPreset: (next: string) => { launchPreset = next; },
    afterRead: (callback: typeof afterRead) => { afterRead = callback; },
    respond: (callback: typeof respond) => { respond = callback; },
  };
}

describe('the shared session creation command', () => {
  it('uses the server-prepared preset without reading model settings, catalog, or projection', async () => {
    const client = fixture();
    const receipt = await client.command('项目会话', { ...client.options, workspace: ' /desktop/project ' });
    expect(receipt).toEqual({ conversation_id: 'session-created', epoch: 7 });
    expect(client.requests.map(request => request.path)).toEqual([TEMPLATES, PRESET, CREATE]);
    expect(client.attempts.every(attempt => attempt.expectedEpoch === 7)).toBe(true);
    expect(client.requests[1].body).toEqual({
      display_name: 'Nomi', reuse_existing: true,
    });
    expect(client.requests[2].key).toBe('same-user-intent');
    expect(client.requests[2].body).toEqual({ preset_id: 'preset-a', title: '项目会话', workspace: '/desktop/project',
      resource_selections: [{ resource_kind: 'workspace', resource_id: 'default-workspace' }] });
  });

  it('creates a Session from an unassigned server preset without inventing a model', async () => {
    const client = fixture();
    client.setLaunchPreset('preset-without-model');
    expect(await client.command(undefined, client.options)).toEqual({ conversation_id: 'session-created', epoch: 7 });
    expect(client.requests.map(request => request.path)).toEqual([TEMPLATES, PRESET, CREATE]);
    expect(client.requests[2].body).toEqual({ preset_id: 'preset-without-model',
      resource_selections: [{ resource_kind: 'workspace', resource_id: 'default-workspace' }] });
  });

  it('rejects a retained old-connection intent before any HTTP', async () => {
    const client = fixture();
    client.setEpoch(8);
    expect(await client.command('旧连接', client.options).catch(error => error)).toBeInstanceOf(StaleConnectionError);
    expect(client.requests).toEqual([]);
  });

  for (const stage of [TEMPLATES, PRESET, CREATE]) {
    it(`fences a connection change between ${stage} completion and the command continuation`, async () => {
      const client = fixture();
      client.afterRead(path => { if (path === stage) client.setEpoch(8); });
      const result = await client.command('创建', client.options).catch(error => error);
      expect(result).toBeInstanceOf(StaleConnectionError);
      expect(client.requests[client.requests.length - 1].path).toBe(stage);
      expect(client.attempts.every(attempt => attempt.expectedEpoch === 7)).toBe(true);
    });

    it(`propagates server failures at ${stage} without continuing creation`, async () => {
      const client = fixture();
      client.respond(async path => path === stage
        ? Response.json({ success: false, message: 'Host preparation unavailable', code: 'HOST_PREPARATION_FAILED' }, { status: 503 })
        : Response.json({ success: true, data: client.payload(path) }));
      const failure = await client.command('创建', client.options).catch(error => error);
      expect(failure).toBeInstanceOf(ApiError);
      expect(failure.status).toBe(503);
      expect(failure.code).toBe('HOST_PREPARATION_FAILED');
      expect(client.requests[client.requests.length - 1].path).toBe(stage);
    });
  }

  it('never swallows authentication, stale-connection, or invalid-contract failures', async () => {
    for (const stage of [TEMPLATES, PRESET, CREATE]) {
      for (const failure of [new AuthExpiredError(), new StaleConnectionError(), new ApiError('Malformed response', 200, 'INVALID_API_RESPONSE')]) {
        const client = fixture();
        client.respond(async path => {
          if (path === stage) throw failure;
          return Response.json({ success: true, data: client.payload(path) });
        });
        expect(await client.command('创建', client.options).catch(error => error)).toBe(failure);
        expect(client.requests[client.requests.length - 1].path).toBe(stage);
      }
    }
  });

  it('reuses the exact prepared body/key after an uncertain POST, even if defaults changed', async () => {
    const client = fixture();
    let loseReceipt = true;
    client.respond(async path => {
      if (path === CREATE && loseReceipt) throw new TypeError('Response lost after commit');
      return Response.json({ success: true, data: client.payload(path) });
    });
    expect(await client.command('创建', client.options).catch(error => error)).toBeInstanceOf(TypeError);
    const first = client.requests[2];
    client.setLaunchPreset('preset-for-new-server-default');
    loseReceipt = false;
    expect(await client.command('创建', client.options)).toEqual({ conversation_id: 'session-created', epoch: 7 });
    expect(client.requests).toHaveLength(4);
    expect(client.requests[3]).toEqual(first);
    expect(client.requests[3].body).toMatchObject({ preset_id: 'preset-a' });
    await client.command('新的创建', { ...client.options, idempotencyKey: 'new-user-intent' });
    expect(client.requests[6].body).toMatchObject({ preset_id: 'preset-for-new-server-default' });
  });

  it('does not let a changed input reuse an uncertain intent key', async () => {
    const client = fixture();
    client.respond(async path => {
      if (path === CREATE) throw new TypeError('Response lost');
      return Response.json({ success: true, data: client.payload(path) });
    });
    await client.command('原始标题', client.options).catch(() => undefined);
    const result = await client.command('不同标题', client.options).catch(error => error);
    expect(result.code).toBe('IDEMPOTENCY_INTENT_CHANGED');
    expect(client.requests).toHaveLength(3);
  });

  it('shares concurrent requests for the same user intent', async () => {
    const client = fixture();
    const first = client.command('创建', client.options);
    const second = client.command('创建', client.options);
    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(client.requests.filter(request => request.path === CREATE)).toHaveLength(1);
  });

  it('preserves uncertain same-epoch requests at the capacity limit and clears them on a connection change', async () => {
    const client = fixture();
    let loseReceipt = true;
    client.respond(async path => {
      if (path === CREATE && loseReceipt) throw new TypeError('Response lost');
      return Response.json({ success: true, data: client.payload(path) });
    });
    for (let index = 0; index < 32; index += 1) {
      await client.command('创建', { ...client.options, idempotencyKey: `intent-${index}` }).catch(() => undefined);
    }
    const count = client.requests.length;
    const rejected = await client.command('创建', { ...client.options, idempotencyKey: 'extra-intent' }).catch(error => error);
    expect(rejected.code).toBe('SESSION_CREATION_PENDING_LIMIT');
    expect(client.requests).toHaveLength(count);
    loseReceipt = false;
    expect(await client.command('创建', { ...client.options, idempotencyKey: 'intent-0' })).toEqual({ conversation_id: 'session-created', epoch: 7 });
    expect(client.requests).toHaveLength(count + 1);
    client.setEpoch(8);
    expect(await client.command('新设备', { ...client.options, expectedEpoch: 8, idempotencyKey: 'new-epoch-intent' })).toEqual({ conversation_id: 'session-created', epoch: 8 });
  });

  it('does not report creation success without a canonical ID in the committed receipt', async () => {
    const client = fixture();
    client.respond(async path => Response.json({ success: true, data: path === CREATE ? {} : client.payload(path) }));
    const error = await client.command('创建', client.options).catch(reason => reason);
    expect(error.code).toBe('INVALID_API_RESPONSE');
  });
});
