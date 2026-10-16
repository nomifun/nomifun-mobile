/**
 * `src/features/customerService/normalize.ts` — the wire normalizers.
 *
 * Two defences carry the whole module and are tested hardest:
 * 1. `knowledge_base_ids` arrives either as a real array or as the JSON-array
 *    *string* the column stores, and a corrupt value must degrade to `[]`
 *    rather than take down the roster.
 * 2. A payload carrying `id` means we are on the wrong contract (business ids
 *    are `cs_*_id`), so normalization throws instead of rendering a row nobody
 *    can address.
 *
 * `buildAgentPatchBody` owns the double-`Option` contract: `undefined` = keep,
 * `null` = clear. Losing that distinction silently wipes a model binding.
 */
import { describe, expect, it } from 'bun:test';

import type { CsAgent, ChannelPluginStatus, ProviderSummary } from '@/features/customerService/types';
import {
  DEFAULT_MAX_CONCURRENT,
  MAX_MAX_CONCURRENT,
  MIN_MAX_CONCURRENT,
  asNoteKind,
  botStatusKey,
  buildAgentPatchBody,
  buildTaskModelGroups,
  clampMaxConcurrent,
  csBotBindingState,
  dialogueVisitorLabel,
  mergeAgent,
  normalizeCsAgent,
  normalizeCsNote,
  normalizeKnowledgeBaseIds,
  selectCsChannelBots,
  toMillis,
} from '@/features/customerService/normalize';

const AGENT_WIRE = {
  cs_agent_id: 'agent-1',
  name: '小助手',
  greeting: '您好',
  persona: '耐心',
  service_policy: '只谈业务',
  provider_id: 'p1',
  model: 'step-3.7-flash',
  knowledge_base_ids: '["kb-1","kb-2"]',
  enabled: true,
  max_concurrent: 8,
  audit_retention_days: 30,
  created_at: 1,
  updated_at: 2,
};

describe('normalizeKnowledgeBaseIds', () => {
  it('passes a real array through, dropping non-string junk', () => {
    expect(normalizeKnowledgeBaseIds(['a', 'b'])).toEqual(['a', 'b']);
    expect(normalizeKnowledgeBaseIds(['a', 1, '', null, undefined, {}, 'b'])).toEqual(['a', 'b']);
    expect(normalizeKnowledgeBaseIds([])).toEqual([]);
  });

  it('parses the stored JSON-array string', () => {
    expect(normalizeKnowledgeBaseIds('["a","b"]')).toEqual(['a', 'b']);
    expect(normalizeKnowledgeBaseIds('  ["a"]  ')).toEqual(['a']);
    expect(normalizeKnowledgeBaseIds('[]')).toEqual([]);
    expect(normalizeKnowledgeBaseIds('["a",2,null]')).toEqual(['a']);
  });

  it('degrades a corrupt or wrongly-typed value to an empty list', () => {
    expect(normalizeKnowledgeBaseIds('not json')).toEqual([]);
    expect(normalizeKnowledgeBaseIds('["a"')).toEqual([]);
    expect(normalizeKnowledgeBaseIds('{"a":1}')).toEqual([]);
    expect(normalizeKnowledgeBaseIds('"a"')).toEqual([]);
    expect(normalizeKnowledgeBaseIds('')).toEqual([]);
    expect(normalizeKnowledgeBaseIds('   ')).toEqual([]);
    expect(normalizeKnowledgeBaseIds(null)).toEqual([]);
    expect(normalizeKnowledgeBaseIds(undefined)).toEqual([]);
    expect(normalizeKnowledgeBaseIds(42)).toEqual([]);
    expect(normalizeKnowledgeBaseIds({ 0: 'a' })).toEqual([]);
  });
});

describe('clampMaxConcurrent', () => {
  it('clamps into the server-validated 1..=64 range', () => {
    expect(clampMaxConcurrent(0)).toBe(MIN_MAX_CONCURRENT);
    expect(clampMaxConcurrent(-5)).toBe(MIN_MAX_CONCURRENT);
    expect(clampMaxConcurrent(65)).toBe(MAX_MAX_CONCURRENT);
    expect(clampMaxConcurrent(1_000_000)).toBe(MAX_MAX_CONCURRENT);
    expect(clampMaxConcurrent(8)).toBe(8);
  });

  it('rounds fractional input and falls back for non-finite input', () => {
    expect(clampMaxConcurrent(3.4)).toBe(3);
    expect(clampMaxConcurrent(3.6)).toBe(4);
    expect(clampMaxConcurrent(Number.NaN)).toBe(DEFAULT_MAX_CONCURRENT);
    expect(clampMaxConcurrent(Number.POSITIVE_INFINITY)).toBe(DEFAULT_MAX_CONCURRENT);
  });
});

describe('normalizeCsAgent', () => {
  it('normalizes a full row', () => {
    const agent = normalizeCsAgent(AGENT_WIRE);
    expect(agent.cs_agent_id).toBe('agent-1');
    expect(agent.knowledge_base_ids).toEqual(['kb-1', 'kb-2']);
    expect(agent.provider_id).toBe('p1');
    expect(agent.max_concurrent).toBe(8);
  });

  it('rejects a payload that carries `id`', () => {
    expect(() => normalizeCsAgent({ ...AGENT_WIRE, id: 'legacy' })).toThrow(TypeError);
    // Even an explicitly-undefined `id` is the wrong contract.
    expect(() => normalizeCsAgent({ ...AGENT_WIRE, id: undefined })).toThrow(TypeError);
  });

  it('rejects a non-object payload', () => {
    expect(() => normalizeCsAgent(null)).toThrow(TypeError);
    expect(() => normalizeCsAgent('agent')).toThrow(TypeError);
    expect(() => normalizeCsAgent([AGENT_WIRE])).toThrow(TypeError);
  });

  it('rejects a missing or empty business id', () => {
    const { cs_agent_id: _omitted, ...withoutId } = AGENT_WIRE;
    expect(() => normalizeCsAgent(withoutId)).toThrow(TypeError);
    expect(() => normalizeCsAgent({ ...AGENT_WIRE, cs_agent_id: '' })).toThrow(TypeError);
    expect(() => normalizeCsAgent({ ...AGENT_WIRE, cs_agent_id: 7 })).toThrow(TypeError);
  });

  it('fills defaults for a sparse row', () => {
    const agent = normalizeCsAgent({ cs_agent_id: 'a' });
    expect(agent.name).toBe('');
    expect(agent.provider_id).toBeNull();
    expect(agent.model).toBeNull();
    expect(agent.knowledge_base_ids).toEqual([]);
    expect(agent.enabled).toBe(true);
    expect(agent.max_concurrent).toBe(DEFAULT_MAX_CONCURRENT);
    expect(agent.audit_retention_days).toBe(30);
    expect(agent.created_at).toBe(0);
  });

  it('turns an empty provider/model string into null (= not configured)', () => {
    const agent = normalizeCsAgent({ ...AGENT_WIRE, provider_id: '', model: '' });
    expect(agent.provider_id).toBeNull();
    expect(agent.model).toBeNull();
  });

  it('clamps a dirty max_concurrent instead of trusting it', () => {
    expect(normalizeCsAgent({ ...AGENT_WIRE, max_concurrent: 0 }).max_concurrent).toBe(1);
    expect(normalizeCsAgent({ ...AGENT_WIRE, max_concurrent: 500 }).max_concurrent).toBe(64);
    expect(normalizeCsAgent({ ...AGENT_WIRE, max_concurrent: '8' }).max_concurrent).toBe(
      DEFAULT_MAX_CONCURRENT,
    );
  });
});

describe('normalizeCsNote', () => {
  it('defaults an unknown kind to faq and keeps enabled true', () => {
    const note = normalizeCsNote({ cs_note_id: 'n1' });
    expect(note.kind).toBe('faq');
    expect(note.enabled).toBe(true);
    expect(note.cs_agent_id).toBeNull();
  });

  it('rejects a payload that carries `id`', () => {
    expect(() => normalizeCsNote({ cs_note_id: 'n1', id: 'legacy' })).toThrow(TypeError);
  });
});

describe('buildAgentPatchBody', () => {
  it('sends nothing for an empty intent', () => {
    expect(buildAgentPatchBody({})).toEqual({});
  });

  it('drops undefined keys (absent = keep)', () => {
    const body = buildAgentPatchBody({ name: 'x', model: undefined });
    expect(body).toEqual({ name: 'x' });
    expect(Object.prototype.hasOwnProperty.call(body, 'model')).toBe(false);
  });

  it('keeps intentional nulls (present-null = clear)', () => {
    const body = buildAgentPatchBody({ provider_id: null, model: null });
    expect(Object.prototype.hasOwnProperty.call(body, 'provider_id')).toBe(true);
    expect(body.provider_id).toBeNull();
    expect(body.model).toBeNull();
  });

  it('keeps falsy-but-meaningful values', () => {
    const body = buildAgentPatchBody({ enabled: false, name: '', audit_retention_days: 0 });
    expect(body).toEqual({ enabled: false, name: '', audit_retention_days: 0 });
  });

  it('clamps max_concurrent on the way out', () => {
    expect(buildAgentPatchBody({ max_concurrent: 999 }).max_concurrent).toBe(64);
    expect(buildAgentPatchBody({ max_concurrent: 0 }).max_concurrent).toBe(1);
  });

  it('passes a knowledge-base list through as a real array', () => {
    expect(buildAgentPatchBody({ knowledge_base_ids: [] }).knowledge_base_ids).toEqual([]);
    expect(buildAgentPatchBody({ knowledge_base_ids: ['kb'] }).knowledge_base_ids).toEqual(['kb']);
  });
});

describe('mergeAgent', () => {
  const agent: CsAgent = normalizeCsAgent(AGENT_WIRE);

  it('applies only the keys the patch mentions', () => {
    const next = mergeAgent(agent, { name: '新名字' });
    expect(next.name).toBe('新名字');
    expect(next.model).toBe(agent.model);
    expect(next.knowledge_base_ids).toEqual(agent.knowledge_base_ids);
  });

  it('applies an intentional null', () => {
    expect(mergeAgent(agent, { model: null }).model).toBeNull();
  });

  it('ignores undefined and clamps like the server would', () => {
    expect(mergeAgent(agent, { model: undefined }).model).toBe(agent.model);
    expect(mergeAgent(agent, { max_concurrent: 999 }).max_concurrent).toBe(64);
  });
});

describe('small selectors', () => {
  it('coerces a note kind into the three known values', () => {
    expect(asNoteKind('script')).toBe('script');
    expect(asNoteKind('fact')).toBe('fact');
    expect(asNoteKind('faq')).toBe('faq');
    expect(asNoteKind('whatever')).toBe('faq');
    expect(asNoteKind('')).toBe('faq');
  });

  it('tolerates second-resolution timestamps', () => {
    expect(toMillis(1_700_000_000)).toBe(1_700_000_000_000);
    expect(toMillis(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toMillis(0)).toBe(0);
    expect(toMillis(-1)).toBe(0);
    expect(toMillis(Number.NaN)).toBe(0);
  });

  it('labels a visitor lane by the tail of its id', () => {
    expect(
      dialogueVisitorLabel({
        cs_dialogue_id: 'd',
        cs_agent_id: 'a',
        channel_plugin_id: 'p',
        channel_user_id: '2f1c8a4e-1111-2222-3333-abcdef123456',
        chat_id: '',
        state: 'open',
        created_at: 0,
        last_activity: 0,
      }),
    ).toBe('123456');
    // Falls back through chat_id to the dialogue id, and never renders empty.
    expect(
      dialogueVisitorLabel({
        cs_dialogue_id: 'zz-99',
        cs_agent_id: 'a',
        channel_plugin_id: 'p',
        channel_user_id: '',
        chat_id: '',
        state: 'open',
        created_at: 0,
        last_activity: 0,
      }),
    ).toBe('ZZ99');
  });
});

describe('bot selection', () => {
  function bot(overrides: Partial<ChannelPluginStatus>): ChannelPluginStatus {
    return {
      plugin_id: 'b1',
      type: 'telegram',
      name: 'bot',
      enabled: true,
      connected: true,
      owner_domain: 'customer_service',
      ...overrides,
    };
  }

  it('keeps only customer-service bots, treating a missing domain as companion', () => {
    const bots = selectCsChannelBots([
      bot({ plugin_id: 'cs' }),
      bot({ plugin_id: 'companion', owner_domain: 'companion' }),
      bot({ plugin_id: 'legacy', owner_domain: undefined }),
    ]);
    expect(bots.map((entry) => entry.plugin_id)).toEqual(['cs']);
  });

  it('derives the binding state from the owner map', () => {
    const owners = new Map([
      ['b1', 'agent-1'],
      ['b2', 'agent-2'],
    ]);
    expect(csBotBindingState('b1', 'agent-1', owners)).toEqual({ kind: 'boundToThis' });
    expect(csBotBindingState('b2', 'agent-1', owners)).toEqual({
      kind: 'boundToOther',
      csAgentId: 'agent-2',
    });
    expect(csBotBindingState('b3', 'agent-1', owners)).toEqual({ kind: 'unbound' });
  });

  it('reports the connection state in priority order', () => {
    expect(botStatusKey(bot({ hasToken: false, enabled: true, connected: true }))).toBe('noToken');
    expect(botStatusKey(bot({ enabled: false }))).toBe('disabled');
    expect(botStatusKey(bot({ connected: false }))).toBe('connecting');
    expect(botStatusKey(bot({}))).toBe('connected');
  });
});

describe('buildTaskModelGroups', () => {
  const providers: ProviderSummary[] = [
    { provider_id: 'p1', name: 'StepFun', platform: 'stepfun', enabled: true },
    { provider_id: 'p2', name: 'DeepSeek', platform: 'deepseek', enabled: true },
  ];

  it('groups by provider, keeps the provider order and dedupes models', () => {
    const groups = buildTaskModelGroups(
      [
        { provider_id: 'p2', model: 'deepseek-chat' },
        { provider_id: 'p1', model: 'step-2' },
        { provider_id: 'p1', model: 'step-1' },
        { provider_id: 'p1', model: 'step-1' },
      ],
      providers,
    );
    expect(groups.map((group) => group.provider.provider_id)).toEqual(['p1', 'p2']);
    expect(groups[0].models).toEqual(['step-2', 'step-1']);
  });

  it('drops refs whose provider metadata is gone, and junk refs', () => {
    const groups = buildTaskModelGroups(
      [
        { provider_id: 'deleted', model: 'x' },
        { provider_id: 'p1', model: 'step-1' },
      ],
      providers,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].provider.provider_id).toBe('p1');
    expect(buildTaskModelGroups([], providers)).toEqual([]);
  });
});
