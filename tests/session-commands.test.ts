import { describe, expect, it } from 'bun:test';
import { createTransportClient, type RequestOptions } from '@/api/transport-client';
import { ApiError, StaleConnectionError } from '@/api/types';
import { createConversationCommand, type SessionRequest } from '@/features/sessions/commands';

const SETTINGS = '/api/settings/client';
const PROVIDERS = '/api/providers';
const TEMPLATES = '/api/agent-preset-templates?source=official';
const PRESET = '/api/agent-presets/from-template/assistant.general';
const CREATE = '/api/agent-sessions';

function fixture() {
  let epoch = 7;
  let model = 'chat-a';
  const requests: { path: string; method: string; key: string | null; body: unknown }[] = [];
  const attempts: { path: string; expectedEpoch?: number }[] = [];
  const payload = (path: string): unknown => {
    if (path === SETTINGS) return { 'nomi.defaultModel': { provider_id: 'provider-a', model } };
    if (path === PROVIDERS) return [{ provider_id: 'provider-a', platform: 'custom', models: [{ model, enabled: true, capabilities: [{ task: 'chat' }] }] }];
    if (path === TEMPLATES) return { official_templates: [{ template_key: 'assistant.general', seed: { required_resource_kinds: ['workspace'] } }] };
    if (path === PRESET) return { preset: { preset_id: 'preset-a' } };
    if (path === CREATE) return { agent_session_id: 'session-created' };
    throw new Error(`Unexpected projection read: ${path}`);
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
    setModel: (next: string) => { model = next; },
    afterRead: (callback: typeof afterRead) => { afterRead = callback; },
    respond: (callback: typeof respond) => { respond = callback; },
  };
}

describe('the shared session creation command', () => {
  it('returns the committed canonical ID without requiring a projection read', async () => {
    const client = fixture();
    const receipt = await client.command('项目会话', { ...client.options, workspace: ' /desktop/project ' });
    expect(receipt).toEqual({ conversation_id: 'session-created', epoch: 7 });
    expect(client.requests.map(request => request.path)).toEqual([SETTINGS, PROVIDERS, TEMPLATES, PRESET, CREATE]);
    expect(client.attempts.every(attempt => attempt.expectedEpoch === 7)).toBe(true);
    expect(client.requests[4].key).toBe('same-user-intent');
    expect(client.requests[4].body).toEqual({ preset_id: 'preset-a', title: '项目会话', workspace: '/desktop/project',
      model: { provider_id: 'provider-a', model: 'chat-a' }, resource_selections: [{ resource_kind: 'workspace', resource_id: 'default-workspace' }] });
  });

  it('rejects a retained old-connection intent before any HTTP', async () => {
    const client = fixture();
    client.setEpoch(8);
    expect(await client.command('旧连接', client.options).catch(error => error)).toBeInstanceOf(StaleConnectionError);
    expect(client.requests).toEqual([]);
  });

  for (const stage of [SETTINGS, PROVIDERS, TEMPLATES, PRESET, CREATE]) {
    it(`fences a connection change between ${stage} completion and the command continuation`, async () => {
      const client = fixture();
      client.afterRead(path => { if (path === stage) client.setEpoch(8); });
      const result = await client.command('创建', client.options).catch(error => error);
      expect(result).toBeInstanceOf(StaleConnectionError);
      expect(client.requests[client.requests.length - 1].path).toBe(stage);
      expect(client.attempts.every(attempt => attempt.expectedEpoch === 7)).toBe(true);
    });
  }

  it('never swallows stale-connection or invalid-contract failures in default-model fallback', async () => {
    for (const failure of [new StaleConnectionError(), new ApiError('Malformed response', 200, 'INVALID_API_RESPONSE')]) {
      const client = fixture();
      client.respond(async () => { throw failure; });
      expect(await client.command('创建', client.options).catch(error => error)).toBe(failure);
      expect(client.requests).toHaveLength(1);
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
    const first = client.requests[4];
    client.setModel('different-default');
    loseReceipt = false;
    expect(await client.command('创建', client.options)).toEqual({ conversation_id: 'session-created', epoch: 7 });
    expect(client.requests).toHaveLength(6);
    expect(client.requests[5]).toEqual(first);
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
    expect(client.requests).toHaveLength(5);
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
