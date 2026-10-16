import { describe, expect, test } from 'bun:test';

import {
  applyCatalogSuggestionForTask,
  capabilityInputFromResponse,
  changeCapabilityProtocol,
  emptyCapabilityDraft,
  joinEndpointUrl,
  patchCapabilityDraft,
  reconcileCapabilityRecommendations,
  type ModelDefinitionDraft,
} from './advanced';
import {
  applyProviderAutoConfiguration,
  selectProviderAutoConfiguration,
  type ProviderAutoConfigurationTarget,
} from './auto-configuration';
import type {
  ModelProtocolManifestResponse,
  ProbeProviderConnectionResponse,
  ProtocolDescriptor,
  ProviderModelCapabilityResponse,
} from './types';

const descriptor = (
  protocol_id: string,
  over: Partial<ProtocolDescriptor> = {},
): ProtocolDescriptor => ({
  protocol_id,
  supported_tasks: ['chat'],
  executor: 'model_invoke',
  transport: 'http',
  allowed_auth_schemes: ['bearer'],
  scopes: ['official_compat'],
  platforms: ['openai'],
  default_connections: [],
  endpoints: [
    {
      task: 'chat',
      field: 'endpoint',
      purpose: 'submit',
      method: 'POST',
      default_value: '/chat/completions',
      allowed_placeholders: [],
      required_placeholders: [],
      editable: true,
      root_shape: 'versioned_root',
    },
  ],
  root_shape: 'versioned_root',
  ...over,
});

const manifest = (
  recommendation: ModelProtocolManifestResponse['recommendation'],
  protocols: ProtocolDescriptor[] = [descriptor('openai.chat_text')],
): ModelProtocolManifestResponse => ({
  tasks: ['chat'],
  preset: 'custom',
  platform: 'custom',
  requested_task: 'chat',
  platform_default_base_url: null,
  requires_user_input: true,
  default_auth_scheme: 'bearer',
  auth_schemes: [{ scheme: 'bearer', parameterized: false }],
  recommendation,
  protocols,
});

const probe = (
  reachability: ProbeProviderConnectionResponse['reachability'],
  protocol: string,
  suggested_base_url?: string,
): ProbeProviderConnectionResponse => ({
  reachability,
  protocol,
  task: 'chat',
  root_shape: 'versioned_root',
  attempted_url: 'https://gateway.example/chat/completions',
  elapsed_ms: 10,
  ...(suggested_base_url ? { suggested_base_url } : {}),
});

describe('mobile model protocol compatibility', () => {
  test('catalog selection preserves other capabilities and adopts context_limit', () => {
    const existing = {
      ...emptyCapabilityDraft('chat'),
      contextLimit: 8_000,
    };
    const definition: ModelDefinitionDraft = {
      model: 'old',
      capabilities: [existing, emptyCapabilityDraft('embedding')],
    };
    const next = applyCatalogSuggestionForTask(
      definition,
      {
        model: 'catalog/chat',
        tasks: ['chat'],
        traits: ['reasoning'],
        contextLimit: 32_000,
      },
      'chat',
    );

    expect(next.model).toBe('catalog/chat');
    expect(next.capabilities.map((item) => item.task)).toEqual([
      'chat',
      'embedding',
    ]);
    expect(next.capabilities[0]?.contextLimit).toBe(8_000);
    expect(next.capabilities[0]?.traits).toEqual(['reasoning']);
  });

  test('recommendations fill a required output ceiling but never overwrite persisted transport', () => {
    const recommended = {
      ...emptyCapabilityDraft('chat'),
      transportSource: 'blank' as const,
    };
    const persisted = {
      ...emptyCapabilityDraft('chat'),
      transportSource: 'persisted' as const,
      protocol: 'old.protocol',
      outputLimit: 12_000,
    };
    const next = reconcileCapabilityRecommendations(
      [recommended, persisted],
      {
        chat: manifest(
          {
            protocol_id: 'openai.chat_text',
            connection_role: null,
            default_base_url: null,
            default_auth_scheme: 'bearer',
            base_url_override_required: false,
          },
          [descriptor('openai.chat_text', { requires_output_ceiling: true })],
        ),
      },
    );

    expect(next[0]?.protocol).toBe('openai.chat_text');
    expect(next[0]?.outputLimit).toBe(4_096);
    expect(next[1]?.protocol).toBe('old.protocol');
    expect(next[1]?.outputLimit).toBe(12_000);
  });

  test('version seams are joined idempotently', () => {
    expect(
      joinEndpointUrl(
        'https://gateway.example/v1',
        '/v1/chat/completions',
      ),
    ).toBe('https://gateway.example/v1/chat/completions');
    expect(
      joinEndpointUrl(
        'https://gateway.example/videos',
        '/videos/{id}',
      ),
    ).toBe('https://gateway.example/videos/videos/{id}');
    expect(
      joinEndpointUrl(
        'https://gateway.example',
        '/v1beta/models/{model}:streamGenerateContent?alt=sse',
      ),
    ).toBe(
      'https://gateway.example/v1beta/models/{model}:streamGenerateContent?alt=sse',
    );
  });

  test('auto detection prefers reachable endpoints and carries the suggested root', () => {
    const first = descriptor('openai.chat_text');
    const second = descriptor('anthropic.messages', {
      allowed_auth_schemes: ['header_key:<name>'],
    });
    const target: ProviderAutoConfigurationTarget = {
      task: 'chat',
      candidates: [
        { descriptor: first, authScheme: 'bearer' },
        { descriptor: second, authScheme: 'header_key:x-api-key' },
      ],
    };
    const selected = selectProviderAutoConfiguration(target, [
      {
        candidate: target.candidates[0]!,
        response: probe(
          'credentials_rejected',
          'openai.chat_text',
        ),
      },
      {
        candidate: target.candidates[1]!,
        response: {
          ...probe(
            'reachable',
            'anthropic.messages',
            'https://gateway.example',
          ),
          candidates: [
            {
              base_url: 'https://gateway.example',
              attempted_url: 'https://gateway.example/chat',
              reachability: 'reachable',
            },
          ],
        },
      },
    ]);

    expect(selected).toMatchObject({
      protocol: 'anthropic.messages',
      authScheme: 'header_key:x-api-key',
      confidence: 'verified',
      suggestedBaseUrl: 'https://gateway.example',
    });
  });

  test('automatic detection does not mutate a user-owned capability', () => {
    const user = {
      ...emptyCapabilityDraft('chat'),
      transportSource: 'user' as const,
      protocol: 'custom.protocol',
      outputLimit: 1_000,
    };
    const definition: ModelDefinitionDraft = {
      model: 'custom',
      capabilities: [user],
    };
    const next = applyProviderAutoConfiguration(definition, [
      {
        task: 'chat',
        protocol: 'openai.chat_text',
        authScheme: 'bearer',
        confidence: 'verified',
        outputLimit: 4_096,
      },
    ]);
    expect(next).toEqual(definition);
  });

  test('explicit transport choices take ownership from automatic detection', () => {
    const automatic = {
      ...emptyCapabilityDraft('chat'),
      transportSource: 'auto' as const,
      protocol: 'openai.chat_text',
    };
    expect(
      changeCapabilityProtocol(
        automatic,
        'openai.chat_text',
        manifest(null),
      ).transportSource,
    ).toBe('user');
    expect(
      patchCapabilityDraft(automatic, { connectionRole: 'speech' })
        .transportSource,
    ).toBe('user');
  });

  test('a probed protocol is not overwritten by the generic manifest recommendation', () => {
    const probed = {
      ...emptyCapabilityDraft('chat'),
      transportSource: 'auto' as const,
      protocol: 'anthropic.messages',
      connectionRole: 'default',
    };
    const next = reconcileCapabilityRecommendations(
      [probed],
      {
        chat: manifest({
          protocol_id: 'openai.chat_text',
          connection_role: null,
          default_base_url: null,
          default_auth_scheme: 'bearer',
          base_url_override_required: false,
        }),
      },
    );
    expect(next[0]).toEqual(probed);
  });

  test('full-save serialization preserves context and output limits', () => {
    const response: ProviderModelCapabilityResponse = {
      task: 'chat',
      traits: ['reasoning'],
      protocol: 'openai.chat_text',
      connection_role: 'default',
      allow_cross_origin_credentials: false,
      provider_params: {},
      context_limit: 32_000,
      output_limit: 4_096,
      health: { status: 'healthy', latency: 10 },
      health_checked_at: 1,
      created_at: 1,
      updated_at: 2,
    };
    const input = capabilityInputFromResponse(response);
    expect(input.context_limit).toBe(32_000);
    expect(input.output_limit).toBe(4_096);
    expect('health' in input).toBe(false);
  });
});
