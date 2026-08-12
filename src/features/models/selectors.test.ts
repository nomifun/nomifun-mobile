import { describe, expect, test } from 'bun:test';

import {
  firstUsableModel,
  isUsableModelRef,
  modelSupportsTask,
  orderSelectorProviders,
  usableModelRefs,
} from './selectors';
import type { ProviderResponse } from './types';

const capability = (
  task: ProviderResponse['models'][number]['capabilities'][number]['task'],
  traits: ProviderResponse['models'][number]['capabilities'][number]['traits'] = [],
) => ({
  task,
  traits,
  protocol: 'test.protocol',
  connection_role: 'default',
  allow_cross_origin_credentials: false,
  provider_params: {},
  created_at: 0,
  updated_at: 0,
});

const provider = (
  provider_id: string,
  over: Partial<ProviderResponse> = {},
): ProviderResponse => ({
  provider_id,
  platform: 'openai',
  name: provider_id,
  base_url: 'https://example.test/v1',
  auth_scheme: 'bearer',
  has_credentials: true,
  models: [],
  enabled: true,
  sort_order: 0,
  created_at: 0,
  updated_at: 0,
  ...over,
});

describe('runtime model selectors', () => {
  test('matches the task and required traits on one capability', () => {
    const chatWithVision = {
      provider_id: 'p',
      model: 'vision-chat',
      enabled: true,
      sort_order: 0,
      capabilities: [capability('chat', ['vision_input'])],
      created_at: 0,
      updated_at: 0,
    };
    const chatWithoutVision = {
      ...chatWithVision,
      model: 'plain-chat',
      capabilities: [capability('chat')],
    };
    const mixedTasks = {
      ...chatWithVision,
      model: 'mixed',
      capabilities: [
        capability('chat'),
        capability('image_generation', ['vision_input']),
      ],
    };

    expect(modelSupportsTask(chatWithVision, 'chat', ['vision_input'])).toBe(true);
    expect(modelSupportsTask(chatWithoutVision, 'chat', ['vision_input'])).toBe(false);
    expect(modelSupportsTask(mixedTasks, 'chat', ['vision_input'])).toBe(false);
  });

  test('filters disabled providers and models', () => {
    const enabled = provider('enabled', {
      models: [
        {
          provider_id: 'enabled',
          model: 'ready',
          enabled: true,
          sort_order: 0,
          capabilities: [capability('chat')],
          created_at: 0,
          updated_at: 0,
        },
        {
          provider_id: 'enabled',
          model: 'off-model',
          enabled: false,
          sort_order: 1,
          capabilities: [capability('chat')],
          created_at: 0,
          updated_at: 0,
        },
      ],
    });
    const disabled = provider('disabled', {
      enabled: false,
      models: [
        {
          provider_id: 'disabled',
          model: 'hidden',
          enabled: true,
          sort_order: 0,
          capabilities: [capability('chat')],
          created_at: 0,
          updated_at: 0,
        },
      ],
    });

    expect(usableModelRefs([disabled, enabled], 'chat')).toEqual([
      { provider_id: 'enabled', model: 'ready' },
    ]);
    expect(firstUsableModel([disabled, enabled], 'chat')).toEqual({
      provider_id: 'enabled',
      model: 'ready',
    });
  });

  test('puts managed providers last but preserves API order within groups', () => {
    const providers = [
      provider('managed-a', { platform: 'nomifun-free-model' }),
      provider('supplier-a', { platform: 'openai' }),
      provider('managed-b', { platform: 'nomifun-free-model' }),
      provider('supplier-b', { platform: 'anthropic' }),
    ];

    expect(orderSelectorProviders(providers).map((item) => item.provider_id)).toEqual([
      'supplier-a',
      'supplier-b',
      'managed-a',
      'managed-b',
    ]);
  });

  test('validates a saved reference against enabled state, task, and traits', () => {
    const providers = [
      provider('p', {
        models: [
          {
            provider_id: 'p',
            model: 'm',
            enabled: true,
            sort_order: 0,
            capabilities: [capability('chat', ['reasoning'])],
            created_at: 0,
            updated_at: 0,
          },
        ],
      }),
    ];
    const ref = { provider_id: 'p', model: 'm' };

    expect(isUsableModelRef(providers, ref, 'chat', ['reasoning'])).toBe(true);
    expect(isUsableModelRef(providers, ref, 'chat', ['vision_input'])).toBe(false);
    expect(isUsableModelRef(providers, ref, 'image_generation')).toBe(false);
    expect(isUsableModelRef(providers, { provider_id: 'missing', model: 'm' }, 'chat')).toBe(false);
    expect(
      isUsableModelRef(
        [provider('p', { enabled: false, models: providers[0]!.models })],
        ref,
        'chat',
      ),
    ).toBe(false);
    expect(
      isUsableModelRef(
        [provider('p', { models: [{ ...providers[0]!.models[0]!, enabled: false }] })],
        ref,
        'chat',
      ),
    ).toBe(false);
  });
});
