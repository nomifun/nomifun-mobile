import { describe, expect, it } from 'bun:test';
import { createTransportClient } from '@/api/transport-client';
import { createModelProtocolApi } from '@/features/models/protocol-api';
import { capabilityInput, connectionInput, modelInput } from '@/features/models/wire';
import { MODEL_TASK_ORDER, MODEL_TRAIT_ORDER, type ProviderModelCapabilityInput } from '@/features/models/types';
import { gatewayAddress, gatewayExternalUrl, gatewayInteger, gatewayMoney } from '@/features/models/gateway';

const capability: ProviderModelCapabilityInput = {
  task: 'chat', traits: ['vision_input'], protocol: 'openai.responses', connection_role: 'default',
  provider_params: { _nomifun_context_limit_kind: 'input_only', reasoning_effort: 'high' },
  context_limit: 200_000, output_limit: 8192, compaction_threshold_pct: 68,
};

describe('current desktop model write contract', () => {
  it('writes the current taxonomy and keeps technical observations out of input', () => {
    expect(MODEL_TASK_ORDER).toContain('music_generation');
    expect([...MODEL_TRAIT_ORDER].sort()).toEqual(['audio_input', 'video_input', 'vision_input', 'web_search']);
    const observed = { ...capability, created_at: 1, updated_at: 2, health: { status: 'healthy', unsupported_technical_capabilities: ['reasoning'] }, health_checked_at: 2 };
    expect(capabilityInput(observed)).toEqual(capability);
  });

  it('roundtrips labels, compaction, explicit missing limits and arbitrary provider parameters through full replacement', () => {
    const row = { model: 'wire-id', display_name: '显示名称', enabled: false, description: null, sort_order: 9,
      provider_id: 'server-only', created_at: 1, capabilities: [{ ...capability, health: { status: 'healthy' } }] };
    expect(modelInput(row)).toEqual({ model: 'wire-id', display_name: '显示名称', enabled: false,
      description: null, sort_order: 9, capabilities: [capability] });
    expect(modelInput({ model: 'wire-id', display_name: null, capabilities: [{ ...capability, output_limit: undefined }] }).capabilities[0]).not.toHaveProperty('output_limit');
    expect(modelInput(row)).not.toHaveProperty('provider_id');
  });

  it('does not copy read-only connection fields into strict DTOs', () => {
    expect(connectionInput({ role: 'vision', base_url: 'https://models.test', auth_scheme: 'bearer', credentials: { api_keys: ['write-only'] }, extra: { configured: true }, connection_id: 'read-only' } as Parameters<typeof connectionInput>[0])).toEqual({
      role: 'vision', base_url: 'https://models.test', auth_scheme: 'bearer', credentials: { api_keys: ['write-only'] }, extra: { configured: true },
    });
  });
});

describe('setup discovery and gateway HTTP adapter', () => {
  const requests: { url: string; method?: string; body: Record<string, unknown> | undefined }[] = [];
  const transport = createTransportClient({ binding: () => null, epoch: () => 3, markAuthExpired: () => {}, sameOrigin: true,
    fetch: (async (url, init) => {
      requests.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify({ success: true, data: { selected_capability: capability, balance: { amount: '9223372036854775807', currency: 'USD' } } }));
    }) as typeof fetch,
  });
  const adapter = createModelProtocolApi(transport.api);

  it('sends anonymous secrets only in the body and preserves apply_recommended_defaults=false', async () => {
    const result = await adapter.discoverModelProtocols({ platform: 'custom', base_url: 'https://provider.test/v1', auth_scheme: 'bearer', credentials: { api_keys: ['secret-material'] },
      model: 'wire-id', capability: { ...capability, health: {} } as ProviderModelCapabilityInput, preferred_protocol: 'openai.responses', apply_recommended_defaults: false }, { expectedEpoch: 3 });
    const sent = requests[requests.length - 1];
    expect(sent.url).toBe('/api/providers/discover-model-protocols');
    expect(sent.method).toBe('POST');
    expect(sent.url).not.toContain('secret');
    expect(sent.body?.capability).toEqual(capability);
    expect(sent.body?.apply_recommended_defaults).toBe(false);
    expect(result.selected_capability).toEqual(capability);
  });

  it('uses saved-provider discovery and includes no credentials or provider_id in its body', async () => {
    await adapter.discoverProviderModelProtocols('provider/id', { model: 'wire-id', capability });
    const sent = requests[requests.length - 1];
    expect(sent.url).toBe('/api/providers/provider%2Fid/discover-model-protocols');
    expect(sent.body).toEqual({ model: 'wire-id', capability });
  });

  it('keeps gateway sync server-owned, credentials write-only, and monetary values lossless', async () => {
    const result = await adapter.modelGateway.account('gateway/id');
    expect(requests[requests.length - 1].method).toBe('GET');
    expect(result.balance.amount).toBe('9223372036854775807');
    await adapter.modelGateway.updateConnection('gateway/id', { base_url: 'https://gateway.test' });
    expect(requests[requests.length - 1]).toEqual({ url: '/api/providers/gateway%2Fid/model-gateway/connection', method: 'PUT', body: { base_url: 'https://gateway.test' } });
    await adapter.modelGateway.sync('gateway/id');
    expect(requests[requests.length - 1]).toEqual({ url: '/api/providers/gateway%2Fid/model-gateway/sync', method: 'POST', body: {} });
    await adapter.modelGateway.create({ base_url: 'https://gateway.test', name: 'Gateway', api_key: 'request-only', models: ['catalog-id'] });
    expect(requests[requests.length - 1].body).toEqual({ base_url: 'https://gateway.test', name: 'Gateway', api_key: 'request-only', models: ['catalog-id'] });
  });

  it('uses every gateway control-plane route with strict request bodies', async () => {
    await adapter.modelGateway.meta({ base_url: 'https://gateway.test', api_key: 'never-sent' } as { base_url: string });
    expect(requests[requests.length - 1]).toEqual({ url: '/api/providers/model-gateway/meta', method: 'POST', body: { base_url: 'https://gateway.test' } });
    await adapter.modelGateway.catalog({ base_url: 'https://gateway.test', api_key: 'body-only' });
    expect(requests[requests.length - 1]).toEqual({ url: '/api/providers/model-gateway/catalog', method: 'POST', body: { base_url: 'https://gateway.test', api_key: 'body-only' } });
    await adapter.modelGateway.providerMeta('gateway/id');
    expect(requests[requests.length - 1]).toEqual({ url: '/api/providers/gateway%2Fid/model-gateway/meta', method: 'GET', body: undefined });
    await adapter.modelGateway.updateConnection('gateway/id', { base_url: 'https://new-gateway.test', api_key: 'new-key', name: 'New operator' });
    expect(requests[requests.length - 1].body).toEqual({ base_url: 'https://new-gateway.test', api_key: 'new-key', name: 'New operator' });
  });

  it('fences setup operations to their original Desktop binding', async () => {
    let rejected = false;
    try { await adapter.modelGateway.sync('gateway', { expectedEpoch: 2 }); } catch { rejected = true; }
    expect(rejected).toBe(true);
  });
});

describe('gateway display contract', () => {
  it('normalizes only root and /v1 addresses and rejects credential-bearing links', () => {
    expect(gatewayAddress(' https://gateway.test/v1/ ')?.root).toBe('https://gateway.test');
    for (const value of ['https://user:key@gateway.test', 'https://gateway.test/other', 'https://gateway.test?key=secret', 'file:///etc/passwd']) expect(gatewayAddress(value)).toBeUndefined();
    expect(gatewayExternalUrl('https://gateway.test/account')).toBe('https://gateway.test/account');
    for (const value of ['http://gateway.test/account', 'https://gateway.test?api_key=secret', 'https://user:key@gateway.test', 'javascript:alert(1)']) expect(gatewayExternalUrl(value)).toBeUndefined();
  });

  it('formats signed int64 minor units without precision loss, including negative cents', () => {
    expect(gatewayMoney('9223372036854775807', 'USD', 'en-US', '?')).toBe('$92,233,720,368,547,758.07');
    expect(gatewayMoney('-1', 'USD', 'en-US', '?')).toBe('-$0.01');
    expect(gatewayMoney('0', 'USD', 'en-US', '?')).toBe('$0.00');
    expect(gatewayMoney('123', 'JPY', 'en-US', '?')).toBe('¥123');
    expect(gatewayInteger('9223372036854775807', 'en-US', '?')).toBe('9,223,372,036,854,775,807');
    expect(gatewayInteger(null, 'en-US', '?')).toBe('?');
    expect(gatewayMoney('9223372036854775808', 'USD', 'en-US', '?')).toBe('?');
    expect(gatewayMoney(9007199254740992 as unknown as string, 'USD', 'en-US', '?')).toBe('?');
  });
});
