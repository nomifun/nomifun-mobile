import { describe, expect, test } from 'bun:test';

import {
  buildModelGroups,
  currentModelRef,
  isSameModel,
  modelLabel,
  supportsModelSwitch,
} from '../model-switch';
import type { Conversation } from '../api';

const conv = (over: Partial<Conversation> = {}): Conversation => ({
  conversation_id: '019f0000-0000-7000-8000-000000000001',
  name: 'x',
  type: 'nomi',
  created_at: 1,
  modified_at: 1,
  ...over,
});

const providers = [
  { provider_id: 'p-step', name: 'StepFun', platform: 'stepfun' },
  { provider_id: 'p-free', name: 'NomiFun Free Model', platform: 'nomifun-free-model' },
];

describe('supportsModelSwitch', () => {
  test('only nomi rows accept {model}', () => {
    expect(supportsModelSwitch(conv({ type: 'nomi' }))).toBe(true);
    // ACP uses PUT .../model plus a mode concept the phone does not implement.
    expect(supportsModelSwitch(conv({ type: 'acp' }))).toBe(false);
    expect(supportsModelSwitch(conv({ type: 'remote' }))).toBe(false);
    expect(supportsModelSwitch(undefined)).toBe(false);
  });
});

describe('currentModelRef / modelLabel', () => {
  test('reads a complete pair', () => {
    const row = conv({ model: { provider_id: 'p-step', model: 'step-3.7-flash' } });
    expect(currentModelRef(row)?.model).toBe('step-3.7-flash');
    expect(modelLabel(row)).toBe('step-3.7-flash');
  });

  test('treats partial or empty bindings as unset', () => {
    expect(currentModelRef(conv({ model: null }))).toBeUndefined();
    expect(currentModelRef(conv({ model: {} }))).toBeUndefined();
    expect(currentModelRef(conv({ model: { provider_id: 'p' } }))).toBeUndefined();
    expect(currentModelRef(conv({ model: { model: 'm' } }))).toBeUndefined();
    expect(currentModelRef(conv({ model: { provider_id: '', model: 'm' } }))).toBeUndefined();
    expect(modelLabel(conv({ model: null }))).toBeUndefined();
  });
});

describe('isSameModel', () => {
  test('compares both halves', () => {
    const ref = { provider_id: 'p-step', model: 'a' };
    expect(isSameModel(ref, { providerId: 'p-step', model: 'a' })).toBe(true);
    expect(isSameModel(ref, { providerId: 'p-step', model: 'b' })).toBe(false);
    expect(isSameModel(ref, { providerId: 'p-free', model: 'a' })).toBe(false);
    expect(isSameModel(undefined, { providerId: 'p-step', model: 'a' })).toBe(false);
  });
});

describe('buildModelGroups', () => {
  test('groups by provider in provider order and dedupes models', () => {
    const groups = buildModelGroups(
      [
        { provider_id: 'p-free', model: 'big-pickle' },
        { provider_id: 'p-step', model: 'step-3.7-flash' },
        { provider_id: 'p-free', model: 'big-pickle' },
        { provider_id: 'p-free', model: 'mimo' },
      ],
      providers,
    );
    expect(groups.map((g) => g.providerId)).toEqual(['p-step', 'p-free']);
    expect(groups[0]?.models).toEqual(['step-3.7-flash']);
    expect(groups[1]?.models).toEqual(['big-pickle', 'mimo']);
  });

  test('flags the managed provider', () => {
    const groups = buildModelGroups([{ provider_id: 'p-free', model: 'x' }], providers);
    expect(groups[0]?.managed).toBe(true);
    const step = buildModelGroups([{ provider_id: 'p-step', model: 'x' }], providers);
    expect(step[0]?.managed).toBe(false);
  });

  test('keeps a current model the resolver no longer returns', () => {
    // A disabled row or a deleted model must still show, or the chip would read
    // as "no model" while the conversation is in fact bound to one.
    const groups = buildModelGroups([{ provider_id: 'p-free', model: 'x' }], providers, {
      provider_id: 'p-step',
      model: 'retired-model',
    });
    const step = groups.find((g) => g.providerId === 'p-step');
    expect(step?.models).toEqual(['retired-model']);
  });

  test('keeps models whose provider is missing from the provider list', () => {
    const groups = buildModelGroups([{ provider_id: 'p-ghost', model: 'm' }], providers);
    expect(groups).toHaveLength(1);
    // Falls back to the id so the row stays selectable and identifiable.
    expect(groups[0]).toMatchObject({ providerId: 'p-ghost', providerName: 'p-ghost', models: ['m'] });
  });

  test('skips malformed candidates and survives missing inputs', () => {
    const groups = buildModelGroups(
      [
        { provider_id: 'p-step', model: '' },
        { provider_id: '', model: 'm' },
        { model: 'm' },
        { provider_id: 'p-step' },
        undefined as unknown as { provider_id: string; model: string },
      ],
      providers,
    );
    expect(groups).toEqual([]);
    expect(buildModelGroups(undefined, undefined)).toEqual([]);
  });

  test('names a provider by id when its name is blank', () => {
    const groups = buildModelGroups([{ provider_id: 'p-x', model: 'm' }], [
      { provider_id: 'p-x', name: '   ', platform: 'openai' },
    ]);
    expect(groups[0]?.providerName).toBe('p-x');
  });
});
