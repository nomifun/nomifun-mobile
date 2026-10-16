/**
 * Unit tests for the binding planner (`bun test`).
 *
 * The invariant under test is the one that can silently unbind a live bot: a
 * toggle must always PUT the whole next set, and stealing must be reported so
 * the UI can warn that another agent loses the bot.
 */
import { describe, expect, it } from 'bun:test';

import {
  boundPluginIds,
  nextBindingIds,
  ownershipAfterReplace,
  planBindingChange,
} from './bindings';
import type { ChannelPluginStatus } from './types';

const A = 'agent-a';
const B = 'agent-b';

const bot = (id: string): ChannelPluginStatus => ({
  plugin_id: id,
  type: 'telegram',
  name: id,
  enabled: true,
  connected: true,
  owner_domain: 'customer_service',
});

const owners = (entries: Array<[string, string]>) => new Map(entries);

describe('boundPluginIds', () => {
  it('keeps pool order and only this agent’s bots', () => {
    const bots = [bot('p1'), bot('p2'), bot('p3')];
    const map = owners([
      ['p3', A],
      ['p1', A],
      ['p2', B],
    ]);
    expect(boundPluginIds(bots, A, map)).toEqual(['p1', 'p3']);
  });

  it('is empty when nothing is bound', () => {
    expect(boundPluginIds([bot('p1')], A, owners([]))).toEqual([]);
  });
});

describe('nextBindingIds', () => {
  it('appends once when binding', () => {
    expect(nextBindingIds(['p1'], 'p2', true)).toEqual(['p1', 'p2']);
    expect(nextBindingIds(['p1', 'p2'], 'p2', true)).toEqual(['p1', 'p2']);
  });

  it('drops the id when unbinding and leaves the rest untouched', () => {
    expect(nextBindingIds(['p1', 'p2', 'p3'], 'p2', false)).toEqual(['p1', 'p3']);
    expect(nextBindingIds(['p1'], 'p9', false)).toEqual(['p1']);
  });

  it('never mutates the input', () => {
    const current = ['p1'];
    nextBindingIds(current, 'p2', true);
    expect(current).toEqual(['p1']);
  });
});

describe('planBindingChange', () => {
  it('binds a free bot and keeps the existing set', () => {
    const plan = planBindingChange({
      pluginId: 'p2',
      csAgentId: A,
      boundIds: ['p1'],
      ownerByBot: owners([['p1', A]]),
    });
    expect(plan).toEqual({ kind: 'bind', nextIds: ['p1', 'p2'], unbindsAll: false });
  });

  it('reports a steal with the losing agent', () => {
    const plan = planBindingChange({
      pluginId: 'p2',
      csAgentId: A,
      boundIds: ['p1'],
      ownerByBot: owners([
        ['p1', A],
        ['p2', B],
      ]),
    });
    expect(plan.kind).toBe('steal');
    expect(plan.fromAgentId).toBe(B);
    expect(plan.nextIds).toEqual(['p1', 'p2']);
  });

  it('unbinds this agent’s bot without touching its siblings', () => {
    const plan = planBindingChange({
      pluginId: 'p1',
      csAgentId: A,
      boundIds: ['p1', 'p2'],
      ownerByBot: owners([
        ['p1', A],
        ['p2', A],
      ]),
    });
    expect(plan).toEqual({ kind: 'unbind', nextIds: ['p2'], unbindsAll: false });
  });

  it('flags the empty PUT that stops the agent serving visitors', () => {
    const plan = planBindingChange({
      pluginId: 'p1',
      csAgentId: A,
      boundIds: ['p1'],
      ownerByBot: owners([['p1', A]]),
    });
    expect(plan.nextIds).toEqual([]);
    expect(plan.unbindsAll).toBe(true);
  });
});

describe('ownershipAfterReplace', () => {
  it('moves a stolen bot to the new owner', () => {
    const next = ownershipAfterReplace(
      owners([
        ['p1', A],
        ['p2', B],
      ]),
      A,
      ['p1', 'p2'],
    );
    expect(next.get('p1')).toBe(A);
    expect(next.get('p2')).toBe(A);
  });

  it('forgets ids this agent released and keeps foreign bindings', () => {
    const next = ownershipAfterReplace(
      owners([
        ['p1', A],
        ['p2', A],
        ['p3', B],
      ]),
      A,
      ['p2'],
    );
    expect(next.has('p1')).toBe(false);
    expect(next.get('p2')).toBe(A);
    expect(next.get('p3')).toBe(B);
  });
});
