import { describe, expect, test } from 'bun:test';
import {
  applyCatalogSuggestionForTask, capabilityInputFromResponse, capabilityInputFromDraft,
  changeCapabilityProtocol, changeModelDefinitionId, emptyCapabilityDraft, patchCapabilityDraft,
  reconcileCapabilityRecommendations, reconcileModelConfigurationDefaults, validateModelDefinition,
  type ModelDefinitionDraft,
} from './advanced';
import { applyDiscoveredCapability, discoveryAppliesDefaults, discoverySnapshot, discoveryContextSnapshot } from './protocol-discovery';
import type { ModelProtocolManifestResponse, ProviderModelCapabilityInput, ProtocolDescriptor } from './types';

const descriptor: ProtocolDescriptor = { protocol_id: 'openai.chat_text', supported_tasks: ['chat'], executor: 'agent', transport: 'http',
  requires_output_ceiling: false, allowed_auth_schemes: ['bearer'], scopes: ['native'], platforms: ['openai'], default_connections: [], endpoints: [] };
const manifest: ModelProtocolManifestResponse = { tasks: ['chat'], preset: 'OpenAI', platform: 'openai', requested_task: 'chat',
  platform_default_base_url: null, requires_user_input: false, default_auth_scheme: 'bearer', auth_schemes: [],
  recommendation: { protocol_id: descriptor.protocol_id, connection_role: 'default', default_base_url: null, default_auth_scheme: 'bearer', base_url_override_required: false },
  protocols: [descriptor], model_defaults: { model: 'model-a', protocol_id: descriptor.protocol_id,
    context_limit: 100000, output_limit: 8000, context_limit_kind: 'combined', provider_params: { temperature: 0.7 },
    sources: ['https://example.com/model-a'], checked_at: '2026-10-16' } };
const draft = (): ModelDefinitionDraft => ({ model: 'model-a', capabilities: [{ ...emptyCapabilityDraft('chat'), protocol: descriptor.protocol_id }] });
const selected: ProviderModelCapabilityInput = { task: 'chat', protocol: 'openai.responses_text', connection_role: 'default',
  context_limit: 99999, output_limit: 32768, compaction_threshold_pct: 80, provider_params: { reasoning: { effort: 'high' } } };

describe('server protocol discovery ownership', () => {
  test('applies exactly the server tested capability without changing identity metadata', () => {
    const definition = { ...draft(), displayName: 'Alias', description: 'Keep description' };
    const next = applyDiscoveredCapability(definition, discoverySnapshot(definition.model, definition.capabilities[0]), selected);
    expect(capabilityInputFromDraft(next.capabilities[0])).toEqual(selected);
    expect(next.displayName).toBe('Alias');
    expect(next.description).toBe('Keep description');
  });
  test('rejects late results after model, parameters, limits or ownership changes', () => {
    const definition = draft();
    const snapshot = discoverySnapshot(definition.model, definition.capabilities[0]);
    for (const changed of [
      { ...definition, model: 'model-b' },
      { ...definition, capabilities: [patchCapabilityDraft(definition.capabilities[0], { providerParamsJson: '{"temperature":1}' })] },
      { ...definition, capabilities: [patchCapabilityDraft(definition.capabilities[0], { outputLimit: 123 })] },
      { ...definition, capabilities: [patchCapabilityDraft(definition.capabilities[0], { providerParamsJson: '' })] },
    ]) expect(applyDiscoveredCapability(changed, snapshot, selected)).toBe(changed);
  });
  test('explicit omissions and persisted params disable refilling defaults', () => {
    expect(discoveryAppliesDefaults(draft().capabilities[0])).toBe(true);
    expect(discoveryAppliesDefaults({ ...draft().capabilities[0], transportSource: 'persisted' })).toBe(false);
    expect(discoveryAppliesDefaults(patchCapabilityDraft(draft().capabilities[0], { providerParamsJson: '' }))).toBe(false);
  });
  test('context snapshots distinguish connection, credentials and account changes', () => {
    const context = { platform: 'custom', baseUrl: 'https://example.com', authScheme: 'bearer', credentials: { api_keys: ['a'] } };
    expect(discoveryContextSnapshot(context)).not.toBe(discoveryContextSnapshot({ ...context, credentials: { api_keys: ['b'] } }));
    expect(discoveryContextSnapshot(context)).not.toBe(discoveryContextSnapshot({ ...context, providerId: 'other' }));
    expect(discoveryContextSnapshot(context)).toBe(discoveryContextSnapshot({ authScheme: context.authScheme, credentials: context.credentials, baseUrl: context.baseUrl, platform: context.platform }));
  });
  test('changing model after discovery releases automatic limits and newly supplied parameters', () => {
    const definition = { ...draft(), capabilities: reconcileModelConfigurationDefaults(draft().capabilities, { chat: manifest }, 'model-a') };
    const current = definition.capabilities[0];
    const tested = { ...capabilityInputFromDraft(current)!, provider_params: { temperature: 0.7, _nomifun_context_limit_kind: 'combined', documented_option: true } };
    const discovered = applyDiscoveredCapability(definition, discoverySnapshot(definition.model, current), tested);
    expect(capabilityInputFromDraft(discovered.capabilities[0])).toEqual(tested);
    const changed = changeModelDefinitionId(discovered, 'model-b').capabilities[0];
    expect(changed.contextLimit).toBeUndefined();
    expect(changed.outputLimit).toBeUndefined();
    expect(changed.providerParamsJson).toBe('');
    expect(changed.protocol).toBe('');
    expect(changed.transportSource).toBe('blank');
  });
  test('discovery retains explicit clears, saved omissions and authored values across model changes', () => {
    const current = patchCapabilityDraft(draft().capabilities[0], { outputLimit: undefined, providerParamsJson: '{"custom":true}' });
    const definition = { ...draft(), capabilities: [current] };
    const tested = capabilityInputFromDraft(current)!;
    const discovered = applyDiscoveredCapability(definition, discoverySnapshot(definition.model, current), tested);
    expect(discovered.capabilities[0].outputLimitSource).toBe('user');
    expect(discoveryAppliesDefaults(discovered.capabilities[0])).toBe(false);
    expect(changeModelDefinitionId(discovered, 'model-b').capabilities[0].providerParamsJson).toBe('{\n  "custom": true\n}');
    const saved = { ...current, transportSource: 'persisted' as const, providerParamsSource: undefined };
    const persisted = applyDiscoveredCapability({ model: 'model-a', capabilities: [saved] }, discoverySnapshot('model-a', saved), tested).capabilities[0];
    expect(discoveryAppliesDefaults(persisted)).toBe(false);
    expect(persisted.outputLimit).toBeUndefined();
  });
});

describe('exact-model advisory configuration', () => {
  test('uses documented context, output and parameters only for the exact model/protocol', () => {
    const base = draft().capabilities;
    const next = reconcileModelConfigurationDefaults(base, { chat: manifest }, 'model-a');
    expect(next[0].contextLimit).toBe(100000);
    expect(next[0].outputLimit).toBe(8000);
    expect(JSON.parse(next[0].providerParamsJson)).toEqual({ temperature: 0.7, _nomifun_context_limit_kind: 'combined' });
    expect(reconcileModelConfigurationDefaults(base, { chat: manifest }, 'model-b')[0]).toBe(base[0]);
    expect(reconcileModelConfigurationDefaults(next, { chat: manifest }, 'model-a')[0]).toBe(next[0]);
  });
  test('changing model releases documented values and retains explicit user edits', () => {
    const configured = { ...draft(), capabilities: reconcileModelConfigurationDefaults(draft().capabilities, { chat: manifest }, 'model-a') };
    const cleared = changeModelDefinitionId(configured, 'model-b');
    expect(cleared.capabilities[0].contextLimit).toBeUndefined();
    expect(cleared.capabilities[0].providerParamsJson).toBe('');
    configured.capabilities[0] = patchCapabilityDraft(configured.capabilities[0], { outputLimit: 4321, providerParamsJson: '{"temperature":0.9}' });
    const kept = changeModelDefinitionId(configured, 'model-b');
    expect(kept.capabilities[0].outputLimit).toBe(4321);
    expect(kept.capabilities[0].providerParamsJson).toBe('{"temperature":0.9}');
  });
  test('never fills explicit clears or persisted omissions with recommendations', () => {
    const userCleared = patchCapabilityDraft(draft().capabilities[0], { contextLimit: undefined, outputLimit: undefined });
    const next = reconcileModelConfigurationDefaults([userCleared], { chat: manifest }, 'model-a')[0];
    expect(next.contextLimit).toBeUndefined();
    expect(next.outputLimit).toBeUndefined();
    const persisted = { ...draft().capabilities[0], transportSource: 'persisted' as const };
    expect(reconcileModelConfigurationDefaults([persisted], { chat: manifest }, 'model-a')[0]).toBe(persisted);
  });
  test('does not invent an output ceiling', () => {
    const next = reconcileCapabilityRecommendations([emptyCapabilityDraft('chat')], { chat: { ...manifest, model_defaults: undefined,
      protocols: [{ ...descriptor, requires_output_ceiling: true }] } });
    expect(next[0].outputLimit).toBeUndefined();
  });
  test('catalog only trusts declared tasks and carries output/context semantics', () => {
    const suggestion = { model: 'catalog', tasks: ['chat' as const], tasksSource: 'provider_declared' as const,
      traits: ['vision_input' as const], contextLimit: 2000, outputLimit: 500, contextLimitKind: 'input_only' as const };
    const next = applyCatalogSuggestionForTask(draft(), suggestion, 'chat');
    expect(next.capabilities[0].outputLimit).toBe(500);
    expect(JSON.parse(next.capabilities[0].providerParamsJson)._nomifun_context_limit_kind).toBe('input_only');
    expect(applyCatalogSuggestionForTask(draft(), { ...suggestion, tasksSource: 'inferred' }, 'chat').capabilities[0].contextLimit).toBeUndefined();
    expect(applyCatalogSuggestionForTask({ model: 'voice', capabilities: [] }, { ...suggestion, tasks: ['speech_synthesis'] }, 'speech_synthesis').capabilities[0].traits).toEqual([]);
  });
  test('a recommendation protocol change releases old automatic parameters while retaining catalog token facts', () => {
    const initial = { ...draft().capabilities[0], transportSource: 'recommendation' as const };
    const configured = reconcileModelConfigurationDefaults([initial], { chat: manifest }, 'model-a');
    const target = { ...manifest, recommendation: { ...manifest.recommendation!, protocol_id: 'another.protocol' },
      model_defaults: { ...manifest.model_defaults!, protocol_id: 'another.protocol', provider_params: { target_option: true } } };
    const recommended = reconcileCapabilityRecommendations(configured, { chat: target });
    const result = reconcileModelConfigurationDefaults(recommended, { chat: target }, 'model-a')[0];
    expect(result.contextLimit).toBe(100000);
    expect(result.outputLimit).toBe(8000);
    expect(JSON.parse(result.providerParamsJson)).toEqual({ _nomifun_context_limit_kind: 'combined', target_option: true });
  });
  test('editing one default parameter retains its value while unrelated automatic values expire with the model', () => {
    const configured = reconcileModelConfigurationDefaults(draft().capabilities, { chat: manifest }, 'model-a')[0];
    const edited = patchCapabilityDraft(configured, { providerParamsJson: '{"temperature":0.9,"_nomifun_context_limit_kind":"combined","custom":true}' });
    const changed = changeModelDefinitionId({ model: 'model-a', capabilities: [edited] }, 'model-b').capabilities[0];
    expect(JSON.parse(changed.providerParamsJson)).toEqual({ temperature: 0.9, custom: true });
  });
  test('late provider catalog limits replace still-owned documented defaults, including input-only context semantics', () => {
    const configured = { ...draft(), capabilities: reconcileModelConfigurationDefaults(draft().capabilities, { chat: manifest }, 'model-a') };
    const suggestion = { model: 'model-a', tasks: ['chat' as const], tasksSource: 'provider_declared' as const, traits: [],
      contextLimit: 200000, outputLimit: 16000, contextLimitKind: 'input_only' as const };
    const next = applyCatalogSuggestionForTask(configured, suggestion, 'chat').capabilities[0];
    expect(next.contextLimit).toBe(200000);
    expect(next.outputLimit).toBe(16000);
    expect(JSON.parse(next.providerParamsJson)._nomifun_context_limit_kind).toBe('input_only');
    const edited = { ...configured, capabilities: [patchCapabilityDraft(configured.capabilities[0], { contextLimit: 12345, outputLimit: undefined })] };
    const kept = applyCatalogSuggestionForTask(edited, suggestion, 'chat').capabilities[0];
    expect(kept.contextLimit).toBe(12345);
    expect(kept.outputLimit).toBeUndefined();
  });
});

describe('complete capability editing', () => {
  test('response roundtrip retains compaction, limits, transport and provider parameters', () => {
    expect(capabilityInputFromResponse({ ...selected, traits: ['vision_input'], allow_cross_origin_credentials: true,
      endpoint: '/responses', poll_endpoint: '/jobs/{job_id}', base_url_override: 'https://other.example/v1' })).toEqual({
      ...selected, traits: ['vision_input'], allow_cross_origin_credentials: true, endpoint: '/responses',
      poll_endpoint: '/jobs/{job_id}', base_url_override: 'https://other.example/v1',
    });
  });
  test('manual protocol switch retains authored provider parameters', () => {
    const capability = { ...draft().capabilities[0], providerParamsJson: '{"custom":{"keep":true}}' };
    expect(changeCapabilityProtocol(capability, 'openai.responses_text').providerParamsJson).toBe(capability.providerParamsJson);
  });
  test('invalid fractional token limits and compaction ranges block save', () => {
    const definition = draft();
    definition.capabilities[0] = { ...definition.capabilities[0], outputLimit: 1.5, compactionThresholdPct: 49 };
    const errors = validateModelDefinition(definition, { chat: manifest }, 'https://example.com/v1').errors.map((error) => error.code);
    expect(errors).toContain('invalid_token_limit');
    expect(errors).toContain('invalid_compaction_threshold');
  });
});
