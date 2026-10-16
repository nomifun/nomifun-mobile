/**
 * Mobile serializers against the actual isolated Desktop HTTP service.
 * Run with Bun (TypeScript only; does not import React Native or mock the API):
 * bun e2e/models-contract.mts --backend-url http://127.0.0.1:18787 --data-dir .tmp-e2e/model-alignment/data
 *
 * Upstream model traffic stays on a short-lived loopback fixture. The script
 * creates and removes only its own providers, retaining the isolated account
 * and database for subsequent browser acceptance.
 */
import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { createTransportClient } from '../src/api/transport-client';
import { ApiError, type AuthLoginResponse, type AuthStatusResponse, type ServerBinding } from '../src/api/types';
import { createModelProtocolApi } from '../src/features/models/protocol-api';
import { capabilityInput, modelInput } from '../src/features/models/wire';
import { capabilityDraftFromResponse, capabilityInputsFromDefinition } from '../src/features/models/advanced';
import type {
  ModelProtocolManifestResponse, ProviderHealthCheckResponse, ProviderModelInput,
  ProviderModelResponse, ProviderResponse, ProviderConnectionResponse,
} from '../src/features/models/types';

const { values } = parseArgs({ options: {
  'backend-url': { type: 'string' }, 'data-dir': { type: 'string' }, help: { type: 'boolean' },
} });
if (values.help) {
  console.log('bun e2e/models-contract.mts --backend-url http://127.0.0.1:<port> --data-dir <isolated-data-directory>');
  process.exit(0);
}
assert.ok(values['backend-url'] && values['data-dir'], 'Supply --backend-url and --data-dir for a separate test installation.');
const baseUrl = new URL(values['backend-url']);
assert.equal(baseUrl.protocol, 'http:');
assert.equal(baseUrl.hostname, '127.0.0.1');
assert.equal(baseUrl.pathname, '/');
const dataDir = resolve(values['data-dir']);
const announced = JSON.parse((await readFile(join(dataDir, 'port.json'), 'utf8')).replace(/^\uFEFF/, '')) as { host: string; port: number; pid: number };
assert.equal(announced.host, '127.0.0.1');
assert.equal(Number(baseUrl.port), announced.port);
assert.ok(announced.pid > 0);

const username = 'mobile-alignment';
const password = 'MobileAlignment-2026-test!';
const fixtureKey = 'local-mobile-contract-fixture-only';
const model = 'mobile-contract-model';
const fixtureRequests: Array<{ host?: string; path: string; model?: string; max_output?: number; replay: boolean }> = [];
const fixtureErrors: string[] = [];
const gatewayKeys = new Map<string, string>();
const gatewayModel = (id: string, endpoint: string, context: number) => ({
  id, display_name: `Catalog ${id}`, vendor: 'local-fixture', tasks: ['chat'],
  task_endpoints: { chat: { endpoints: [endpoint], preferred_endpoint: endpoint } },
  context_window: context, max_output_tokens: 4096, input_modalities: ['text', 'image'], traits: ['vision_input'],
  pricing: [{ task: 'chat', meter: 'input_tokens', unit_size: '__I64_MAX__', amount: '__I64_MAX__', currency: 'USD' }],
  included_in_plan: true, status: 'available',
});
let gatewayModels = [gatewayModel('gateway-alpha', 'openai-response', 128_000),
  gatewayModel('gateway-beta', 'anthropic', 200_000), gatewayModel('gateway-gamma', 'gemini', 1_000_000)];
const exactJson = (value: unknown) => JSON.stringify(value)
  .replaceAll('"__I64_MAX__"', '9223372036854775807').replaceAll('"__I64_MIN__"', '-9223372036854775808');
const gatewayMeta = { contract_version: '1.0', operator: { name: 'Local Fixture Operator',
  homepage_url: 'https://operator.example/', console_url: 'https://operator.example/console',
  purchase_url: 'https://operator.example/purchase', terms_url: null, privacy_url: null },
  capabilities: ['openai-response', 'anthropic', 'gemini'], optional_endpoints: [] };
const gatewayAccount = { contract_version: '1.0', plan: { name: 'Fixture Plan',
  period_start: null, period_end: null, quota: { unit: 'tokens', total: null, used: '__I64_MAX__' } },
  balance: { amount: '__I64_MIN__', currency: 'USD' },
  key: { name: 'Fixture Key', expires_at: null, quota_unit: 'tokens', remaining_quota: null },
  rate_limits: { requests_per_minute: null, tokens_per_minute: '__I64_MAX__', concurrent_requests: 0 } };
const report = {
  schema: 'nomifun.mobile-model-contract.v1', generated_at: new Date().toISOString(),
  backend_url: baseUrl.origin, backend_pid: announced.pid, account: username,
  scope: 'Production Mobile transport, protocol API and model serializers against the isolated production Desktop HTTP service; synthetic local upstream only.',
  checks: [] as string[], fixture_requests: fixtureRequests, fixture_errors: fixtureErrors,
  passed: false, failure: undefined as string | undefined,
};

function chatEvents(replay: boolean): string {
  const delta = replay ? { content: 'OK' } : { tool_calls: [{ index: 0, id: 'call_fixture', type: 'function',
    function: { name: 'nomifun_protocol_echo', arguments: '{"value":"ok"}' } }] };
  return [{ choices: [{ index: 0, delta, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: replay ? 'stop' : 'tool_calls' }],
      usage: { prompt_tokens: 3, completion_tokens: 1 } }]
    .map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n';
}

function responsesEvents(replay: boolean): string {
  const responseId = replay ? 'response_fixture_2' : 'response_fixture_1';
  const events: unknown[] = [{ type: 'response.created', response: { id: responseId, status: 'in_progress', output: [] } }];
  let output: unknown[];
  if (replay) {
    const part = { type: 'output_text', text: 'OK', annotations: [] };
    const item = { id: 'message_fixture', type: 'message', role: 'assistant', status: 'completed', content: [part] };
    events.push(
      { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
      { type: 'response.content_part.added', output_index: 0, item_id: item.id, content_index: 0, part: { ...part, text: '' } },
      { type: 'response.output_text.delta', output_index: 0, item_id: item.id, content_index: 0, delta: 'OK' },
      { type: 'response.output_text.done', output_index: 0, item_id: item.id, content_index: 0, text: 'OK' },
      { type: 'response.content_part.done', output_index: 0, item_id: item.id, content_index: 0, part },
      { type: 'response.output_item.done', output_index: 0, item },
    );
    output = [item];
  } else {
    const item = { id: 'function_fixture', call_id: 'call_fixture', type: 'function_call',
      name: 'nomifun_protocol_echo', arguments: '{"value":"ok"}', status: 'completed' };
    events.push(
      { type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '', status: 'in_progress' } },
      { type: 'response.function_call_arguments.delta', output_index: 0, item_id: item.id, delta: item.arguments },
      { type: 'response.function_call_arguments.done', output_index: 0, item_id: item.id, arguments: item.arguments },
      { type: 'response.output_item.done', output_index: 0, item },
    );
    output = [item];
  }
  events.push({ type: 'response.completed', response: { id: responseId, status: 'completed', output,
    usage: { input_tokens: 3, output_tokens: 1 } } });
  return events.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('');
}

function anthropicEvents(replay: boolean): string {
  const events = [
    { type: 'message_start', message: { id: 'message_fixture', type: 'message', role: 'assistant', content: [],
      model: 'gateway-beta', usage: { input_tokens: 3, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: replay ? { type: 'text', text: '' }
      : { type: 'tool_use', id: 'call_fixture', name: 'nomifun_protocol_echo', input: {} } },
    { type: 'content_block_delta', index: 0, delta: replay ? { type: 'text_delta', text: 'OK' }
      : { type: 'input_json_delta', partial_json: '{"value":"ok"}' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: replay ? 'end_turn' : 'tool_use' }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ];
  return events.map((frame) => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join('');
}

const serveFixture: RequestListener = async (request, response) => {
  try {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const gatewayKey = gatewayKeys.get(request.headers.host ?? '') ?? fixtureKey;
    if (path === '/nomifun/v1/meta') assert.equal(request.headers.authorization, undefined);
    else if (path === '/v1/messages') {
      assert.equal(request.headers['x-api-key'], gatewayKey);
      assert.equal(request.headers['anthropic-version'], '2023-06-01');
    } else if (path.startsWith('/v1beta/models/')) assert.equal(request.headers['x-goog-api-key'], gatewayKey);
    else assert.equal(request.headers.authorization, `Bearer ${gatewayKey}`);
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
    const replay = /function_call_output|tool_result|functionResponse/.test(JSON.stringify(body.messages ?? body.input ?? body.contents ?? [])) ||
      (Array.isArray(body.messages) && body.messages.some((item: { role?: string }) => item.role === 'tool'));
    fixtureRequests.push({ host: request.headers.host, path, model: body.model as string | undefined,
      max_output: (body.max_output_tokens ?? body.max_tokens) as number | undefined, replay });
    if (path.startsWith('/nomifun/v1/')) {
      assert.equal(request.method, 'GET');
      response.writeHead(200, { 'content-type': 'application/json' });
      const value = path.endsWith('/meta') ? gatewayMeta : path.endsWith('/account') ? gatewayAccount
        : { contract_version: '1.0', models: gatewayModels };
      response.end(exactJson(value));
    } else if (path === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: [{ id: model, object: 'model', owned_by: 'local-fixture' }] }));
    } else if (path === '/v1/chat/completions' || path === '/v1/responses') {
      assert.ok(body.model === model || body.model === 'gateway-alpha');
      assert.equal(body.stream, true);
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      response.end(path.endsWith('/responses') ? responsesEvents(replay) : chatEvents(replay));
    } else if (path === '/v1/messages') {
      assert.equal(body.model, 'gateway-beta'); assert.equal(body.stream, true);
      response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(anthropicEvents(replay));
    } else if (path === '/v1beta/models/gateway-gamma:streamGenerateContent') {
      const part = replay ? { text: 'OK' } : { functionCall: { id: 'call_fixture', name: 'nomifun_protocol_echo', args: { value: 'ok' } }, thoughtSignature: 'local-fixture-signature' };
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ candidates: [{ index: 0, content: { role: 'model', parts: [part] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 } })}\n\n`);
    } else if (path === '/music_generation') {
      assert.equal(body.model, 'music-3.0');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ base_resp: { status_code: 0 }, data: { status: 2, audio: '494433' } }));
    } else {
      throw new Error(`Unexpected upstream route ${path}`);
    }
  } catch (error) {
    fixtureErrors.push(error instanceof Error ? error.message : String(error));
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'Local fixture contract rejected the request' } }));
  }
};
const fixture = createServer(serveFixture);
await new Promise<void>((accept, reject) => { fixture.once('error', reject); fixture.listen(0, '127.0.0.1', accept); });
const fixtureAddress = fixture.address();
assert.ok(fixtureAddress && typeof fixtureAddress !== 'string');
const upstream = `http://127.0.0.1:${fixtureAddress.port}`;
gatewayKeys.set(`127.0.0.1:${fixtureAddress.port}`, fixtureKey);
const relocatedFixture = createServer(serveFixture);
await new Promise<void>((accept, reject) => { relocatedFixture.once('error', reject); relocatedFixture.listen(0, '127.0.0.1', accept); });
const relocatedAddress = relocatedFixture.address();
assert.ok(relocatedAddress && typeof relocatedAddress !== 'string');
const relocatedUpstream = `http://127.0.0.1:${relocatedAddress.port}`;
const relocatedKey = 'local-fixture-new-origin-key';
gatewayKeys.set(`127.0.0.1:${relocatedAddress.port}`, relocatedKey);
let binding: ServerBinding = { baseUrl: baseUrl.origin, token: '', user: null };
const transport = createTransportClient({ binding: () => binding, epoch: () => 1,
  verified: () => true, markAuthExpired: () => { throw new Error('The isolated fixture credential was rejected'); } });
const protocolApi = createModelProtocolApi(transport.api);
const ownedProviders: string[] = [];

const check = async (name: string, action: () => Promise<void>) => {
  await action(); report.checks.push(name); console.log(`PASS ${name}`);
};
const modelRows = (providerId: string) => transport.api<ProviderModelResponse[]>(`/api/provider-models?provider_id=${encodeURIComponent(providerId)}`);
async function expectBadRequest(action: () => Promise<unknown>) {
  await assert.rejects(action, (error: unknown) => error instanceof ApiError && error.status === 400);
}
const manifest = (preset: string, task: string, selectedModel: string) => transport.api<ModelProtocolManifestResponse>(
  `/api/model-protocols?${new URLSearchParams({ preset, task, model: selectedModel })}`,
);
const saveModel = (providerId: string, input: ProviderModelInput) => transport.api<ProviderModelResponse>('/api/provider-models', {
  method: 'PUT', body: { provider_id: providerId, model: modelInput(input) },
});
const health = (providerId: string, selectedModel: string, task: string) => transport.api<ProviderHealthCheckResponse>(
  '/api/agents/provider-health-check', { timeoutMs: 65_000, body: { provider_id: providerId, model: selectedModel, task } },
);

try {
  await check('authenticated isolated device setup/login and protected system identity', async () => {
    const status = await transport.rawRequest<AuthStatusResponse>('/api/auth/status');
    if (!status.is_authenticated || status.needs_setup) {
      const result = await transport.rawRequest<AuthLoginResponse>(status.needs_setup ? '/api/auth/device-setup' : '/api/auth/device-login', {
        token: '', body: { username, password, device_name: 'Mobile model contract', protocol_version: 1 },
      });
      assert.equal(result.success, true); assert.ok(result.token && result.device?.device_id);
      binding = { ...binding, token: result.token, user: result.user ?? null };
    }
    const identity = await transport.api<{ storage_generation: string; agent_data_generation: number }>('/api/system/info');
    assert.ok(identity.storage_generation); assert.ok(Number.isInteger(identity.agent_data_generation));
  });
  await check('manifest exact model defaults, unknown model absence and music modality', async () => {
    const known = await manifest('OpenAI', 'chat', 'gpt-6.1-sol');
    assert.equal(known.model_defaults?.model, 'gpt-6.1-sol');
    assert.equal(known.model_defaults?.context_limit, 1_050_000); assert.equal(known.model_defaults?.output_limit, 128_000);
    assert.equal(known.model_defaults?.provider_params.reasoning_effort, 'medium');
    assert.ok(known.model_defaults?.sources.length); assert.ok(known.model_defaults?.checked_at);
    assert.ok(!(await manifest('OpenAI', 'chat', 'mobile-user-unknown-model')).model_defaults);
    const music = await manifest('MiniMax', 'music_generation', 'music-3.0');
    assert.ok(music.tasks.includes('music_generation'));
    assert.ok(music.protocols.some((item) => item.protocol_id === 'minimax.music' && item.supported_tasks.includes('music_generation')));
    const anthropic = await manifest('Anthropic', 'chat', 'mobile-user-unknown-model');
    assert.ok(anthropic.protocols.some((item) => item.protocol_id === 'anthropic.messages' && item.requires_output_ceiling));
  });
  const input: ProviderModelInput = {
    model, display_name: '本地协议验收模型', enabled: true, description: 'Loopback fixture; no external credentials', sort_order: 7,
    capabilities: [{ task: 'chat', traits: ['vision_input'], protocol: 'openai.chat_text', connection_role: 'default',
      provider_params: {}, context_limit: 64_000, output_limit: 16_000, compaction_threshold_pct: 60 }],
  };
  let provider!: ProviderResponse;
  await check('provider creation and strict model metadata round trip', async () => {
    provider = await transport.api<ProviderResponse>('/api/providers', { body: {
      platform: 'openai', name: `Mobile contract ${Date.now()}`, base_url: `${upstream}/v1`,
      auth_scheme: 'bearer', credentials: { api_keys: [fixtureKey] }, initial_model: modelInput(input),
    } });
    ownedProviders.push(provider.provider_id);
    assert.equal(provider.models[0].display_name, input.display_name);
    assert.equal(provider.models[0].capabilities[0].compaction_threshold_pct, 60);
    assert.equal(provider.has_credentials, true);
    assert.ok(!JSON.stringify(provider).includes(fixtureKey));
  });
  await check('anonymous discovery verifies actual streamed tool replay with saved ceilings', async () => {
    const result = await protocolApi.discoverModelProtocols({ platform: 'openai', base_url: `${upstream}/v1`,
      auth_scheme: 'bearer', credentials: { api_keys: [fixtureKey] }, model,
      capability: capabilityInput(input.capabilities[0]), preferred_protocol: 'openai.chat_text',
    }, { expectedEpoch: 1 });
    assert.equal(result.selected_protocol, 'openai.chat_text');
    assert.equal(result.selected_capability?.output_limit, 16_000);
    assert.equal(result.selected_capability?.compaction_threshold_pct, 60);
    for (const protocol of ['openai.chat_text', 'openai.responses']) {
      const candidate = result.candidates.find((item) => item.protocol === protocol);
      assert.equal(candidate?.status, 'available'); assert.equal(candidate?.evidence, 'verified_stream');
      assert.equal(candidate?.probe_output_limit, 16_000);
    }
    assert.ok(fixtureRequests.filter((item) => item.path === '/v1/chat/completions' && item.replay).length);
    assert.ok(fixtureRequests.filter((item) => item.path === '/v1/responses' && item.replay).length);
  });
  await check('saved-provider discovery retains revision and does not silently write a selection', async () => {
    const result = await protocolApi.discoverProviderModelProtocols(provider.provider_id, {
      model, capability: capabilityInput(input.capabilities[0]), preferred_protocol: 'openai.responses',
    }, { expectedEpoch: 1 });
    assert.equal(result.selected_protocol, 'openai.responses');
    assert.ok(typeof result.config_revision === 'number');
    const rows = await modelRows(provider.provider_id);
    assert.equal(rows[0].capabilities[0].protocol, 'openai.chat_text');
  });
  await check('saved chat health uses actual production Agent wire verification', async () => {
    const result = await health(provider.provider_id, model, 'chat');
    assert.equal(result.status, 'healthy'); assert.equal(result.task, 'chat');
    assert.equal(result.attempted_url, `${upstream}/v1/chat/completions`);
    assert.ok(fixtureRequests.filter((item) => item.max_output === 16_000).length >= 10);
  });
  await check('editor full save and disable/enable retain aliases, budgets and compaction', async () => {
    const row = (await modelRows(provider.provider_id))[0];
    const capabilities = capabilityInputsFromDefinition({ model: row.model, displayName: row.display_name,
      capabilities: row.capabilities.map(capabilityDraftFromResponse) });
    assert.ok(capabilities);
    for (const enabled of [false, true]) {
      const saved = await saveModel(provider.provider_id, { model: row.model, display_name: row.display_name ?? null,
        enabled, description: row.description ?? null, sort_order: row.sort_order, capabilities });
      assert.equal(saved.enabled, enabled); assert.equal(saved.display_name, row.display_name);
      assert.equal(saved.capabilities[0].compaction_threshold_pct, 60);
      assert.equal(saved.capabilities[0].context_limit, 64_000); assert.equal(saved.capabilities[0].output_limit, 16_000);
      assert.equal(saved.description, row.description); assert.equal(saved.sort_order, 7);
    }
  });
  await check('strict DTOs and invalid compaction reject writes without changing the model', async () => {
    await expectBadRequest(() => transport.api('/api/provider-models', { method: 'PUT', body: {
      provider_id: provider.provider_id, model: { ...modelInput(input), response_only: true },
    } }));
    await expectBadRequest(() => saveModel(provider.provider_id, { ...input,
      capabilities: [{ ...input.capabilities[0], compaction_threshold_pct: 49 }] }));
    await expectBadRequest(() => transport.api('/api/providers/discover-model-protocols', { body: { model } }));
    const rows = await modelRows(provider.provider_id);
    assert.equal(rows[0].display_name, input.display_name); assert.equal(rows[0].capabilities[0].compaction_threshold_pct, 60);
  });
  await check('music generation capability round trip and actual local modality health', async () => {
    const music = await transport.api<ProviderResponse>('/api/providers', { body: {
      platform: 'minimax', name: `Mobile music contract ${Date.now()}`, base_url: upstream,
      auth_scheme: 'bearer', credentials: { api_keys: [fixtureKey] }, initial_model: modelInput({
        model: 'music-3.0', display_name: '本地音乐验收', capabilities: [{ task: 'music_generation', traits: [],
          protocol: 'minimax.music', connection_role: 'default', provider_params: {}, endpoint: '/music_generation' }],
      }),
    } });
    ownedProviders.push(music.provider_id);
    const row = (await modelRows(music.provider_id))[0];
    assert.equal(row.display_name, '本地音乐验收'); assert.equal(row.capabilities[0].task, 'music_generation');
    const result = await health(music.provider_id, 'music-3.0', 'music_generation');
    assert.equal(result.status, 'healthy'); assert.equal(result.attempted_url, `${upstream}/music_generation`);
    assert.ok(fixtureRequests.some((item) => item.path === '/music_generation'));
  });
  let gateway!: ProviderResponse;
  await check('gateway meta/catalog/create/account preserve exact native int64 values as decimal strings', async () => {
    const meta = await protocolApi.modelGateway.meta({ base_url: `${upstream}/v1` });
    assert.equal(meta.operator.name, 'Local Fixture Operator');
    const catalog = await protocolApi.modelGateway.catalog({ base_url: upstream, api_key: fixtureKey });
    assert.equal(catalog.models[0].pricing[0].amount, '9223372036854775807');
    assert.equal(catalog.models[0].pricing[0].unit_size, '9223372036854775807');
    assert.equal(catalog.imports[0].display_name, 'Catalog gateway-alpha');
    assert.equal(catalog.imports[0].capabilities[0].protocol, 'openai.responses');
    assert.equal(catalog.imports[1].capabilities[0].connection_role, 'anthropic');
    assert.equal(catalog.imports[2].capabilities[0].connection_role, 'gemini');
    gateway = await protocolApi.modelGateway.create({ base_url: upstream, api_key: fixtureKey,
      name: `Mobile gateway contract ${Date.now()}`, models: catalog.models.map((item) => item.id) });
    ownedProviders.push(gateway.provider_id);
    assert.equal(gateway.platform, 'nomifun-model-gateway'); assert.equal(gateway.models.length, 3);
    assert.ok(!JSON.stringify(gateway).includes(fixtureKey));
    const account = await protocolApi.modelGateway.account(gateway.provider_id);
    assert.equal(account.balance.amount, '-9223372036854775808');
    assert.equal(account.plan?.quota.used, '9223372036854775807'); assert.equal(account.plan?.quota.total, null);
    assert.equal(account.key.remaining_quota, null); assert.equal(account.rate_limits.requests_per_minute, null);
    assert.equal(account.rate_limits.tokens_per_minute, '9223372036854775807');
    assert.equal(account.rate_limits.concurrent_requests, '0');
    assert.equal((await protocolApi.modelGateway.providerMeta(gateway.provider_id)).contract_version, '1.0');
  });
  await check('gateway sync preserves explicit edits, disabled models and remotely missing rows', async () => {
    const alpha = gateway.models.find((item) => item.model === 'gateway-alpha'); assert.ok(alpha);
    await saveModel(gateway.provider_id, { model: alpha.model, display_name: '用户自定义网关模型',
      enabled: false, description: 'User-owned notes', sort_order: 12,
      capabilities: alpha.capabilities.map((cap) => ({ ...capabilityInput(cap), protocol: 'openai.chat_text',
        context_limit: 7777, output_limit: 2048, compaction_threshold_pct: 67 })),
    });
    gatewayModels = [gatewayModel('gateway-alpha', 'anthropic', 256_000),
      gatewayModel('gateway-beta', 'anthropic', 300_000), gatewayModel('gateway-delta', 'openai', 64_000)];
    const synced = await protocolApi.modelGateway.sync(gateway.provider_id);
    assert.equal(synced.added, 1); assert.equal(synced.models.length, 4);
    const custom = synced.models.find((item) => item.model === 'gateway-alpha'); assert.ok(custom);
    assert.equal(custom.display_name, '用户自定义网关模型'); assert.equal(custom.enabled, false);
    assert.equal(custom.description, 'User-owned notes'); assert.equal(custom.sort_order, 12);
    assert.equal(custom.capabilities[0].protocol, 'openai.chat_text'); assert.equal(custom.capabilities[0].connection_role, 'default');
    assert.equal(custom.capabilities[0].context_limit, 7777); assert.equal(custom.capabilities[0].output_limit, 2048);
    assert.equal(custom.capabilities[0].compaction_threshold_pct, 67);
    assert.equal(synced.models.find((item) => item.model === 'gateway-beta')?.capabilities[0].context_limit, 300_000);
    assert.ok(synced.models.some((item) => item.model === 'gateway-gamma'));
    const unchanged = await protocolApi.modelGateway.sync(gateway.provider_id);
    assert.equal(unchanged.added, 0); assert.equal(unchanged.updated, 0);
  });
  await check('gateway same-origin connection edits retain credentials and rotate explicit keys', async () => {
    const renamed = await protocolApi.modelGateway.updateConnection(gateway.provider_id, {
      base_url: `${upstream}/v1`, name: 'Renamed local gateway',
    });
    assert.equal(renamed.name, 'Renamed local gateway'); assert.equal(renamed.base_url, `${upstream}/v1`);
    assert.equal((await protocolApi.modelGateway.account(gateway.provider_id)).key.name, 'Fixture Key');
    const rotatedKey = 'local-fixture-rotated-key';
    gatewayKeys.set(`127.0.0.1:${fixtureAddress.port}`, rotatedKey);
    const rotated = await protocolApi.modelGateway.updateConnection(gateway.provider_id, { base_url: upstream, api_key: rotatedKey });
    assert.equal(rotated.has_credentials, true); assert.ok(!JSON.stringify(rotated).includes(rotatedKey));
    assert.equal((await protocolApi.modelGateway.account(gateway.provider_id)).balance.amount, '-9223372036854775808');
  });
  await check('gateway origin changes require an explicit key before contacting the new origin', async () => {
    const before = fixtureRequests.filter((item) => item.host === `127.0.0.1:${relocatedAddress.port}`).length;
    await expectBadRequest(() => protocolApi.modelGateway.updateConnection(gateway.provider_id, { base_url: relocatedUpstream }));
    assert.equal(fixtureRequests.filter((item) => item.host === `127.0.0.1:${relocatedAddress.port}`).length, before);
    const unchanged = (await transport.api<ProviderResponse[]>('/api/providers')).find((item) => item.provider_id === gateway.provider_id);
    assert.equal(unchanged?.base_url, `${upstream}/v1`);
    const moved = await protocolApi.modelGateway.updateConnection(gateway.provider_id, { base_url: relocatedUpstream, api_key: relocatedKey });
    assert.equal(moved.base_url, `${relocatedUpstream}/v1`);
    const connections = await transport.api<ProviderConnectionResponse[]>(`/api/providers/${encodeURIComponent(gateway.provider_id)}/connections`);
    assert.deepEqual(connections.map((item) => item.role).sort(), ['anthropic', 'gemini']);
    assert.ok(connections.every((item) => item.base_url === relocatedUpstream && item.has_credentials));
    assert.equal((await protocolApi.modelGateway.account(gateway.provider_id)).key.name, 'Fixture Key');
  });
  await check('gateway moved credentials work across OpenAI, Anthropic and Gemini roles', async () => {
    const alpha = (await modelRows(gateway.provider_id)).find((item) => item.model === 'gateway-alpha'); assert.ok(alpha);
    await saveModel(gateway.provider_id, { model: alpha.model, display_name: alpha.display_name,
      enabled: true, description: alpha.description, sort_order: alpha.sort_order, capabilities: alpha.capabilities.map(capabilityInput) });
    for (const selectedModel of ['gateway-alpha', 'gateway-beta', 'gateway-gamma']) {
      const result = await health(gateway.provider_id, selectedModel, 'chat');
      assert.equal(result.status, 'healthy', `${selectedModel}: ${result.message ?? result.error_kind}`);
      assert.ok(result.attempted_url?.startsWith(relocatedUpstream));
    }
  });
  assert.deepEqual(fixtureErrors, []);
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
  console.error(report.failure);
} finally {
  for (const id of ownedProviders.reverse()) {
    try { await transport.api(`/api/providers/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
    catch (error) { report.passed = false; process.exitCode = 1; report.failure = `Fixture provider cleanup failed: ${error instanceof Error ? error.message : error}`; }
  }
  await new Promise<void>((accept, reject) => fixture.close((error) => error ? reject(error) : accept()));
  await new Promise<void>((accept, reject) => relocatedFixture.close((error) => error ? reject(error) : accept()));
  const reportPath = join(dirname(dataDir), 'model-contract-report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`Report: ${reportPath}`);
  console.log(`Isolated account retained: ${username}`);
}
