import { describe, expect, it } from 'bun:test';
import type { Conversation, Paginated } from '@/features/sessions/api';
import { createSessionCatalog } from '@/features/sessions/catalog';
import { attachSessionSync, type SessionSyncSource } from '@/features/sessions/sync';

const topics = [
  'ws.ready', 'ws.reconnected', 'conversation.listChanged',
  'agentSession.agentChanged', 'agentSession.knowledgeChanged', 'turn.started', 'turn.completed',
];

function sourceFixture() {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const foreground = new Set<() => void>();
  let removals = 0;
  const source: SessionSyncSource = {
    onTopic(topic, handler) {
      const subscribers = handlers.get(topic) ?? new Set<(payload: unknown) => void>();
      handlers.set(topic, subscribers);
      subscribers.add(handler);
      return () => { subscribers.delete(handler); removals += 1; };
    },
    onForeground(handler) {
      foreground.add(handler);
      return () => { foreground.delete(handler); removals += 1; };
    },
  };
  return {
    source,
    subscribedTopics: () => [...handlers].filter(([, subscribers]) => subscribers.size > 0).map(([topic]) => topic),
    foregroundCount: () => foreground.size,
    removals: () => removals,
    emit: (topic: string, payload: unknown = {}) => { for (const callback of [...(handlers.get(topic) ?? [])]) callback(payload); },
    resume: () => { for (const callback of [...foreground]) callback(); },
    queuedTopic: (topic: string) => {
      const queued = [...(handlers.get(topic) ?? [])];
      return () => { for (const callback of queued) callback({}); };
    },
    queuedForeground: () => {
      const queued = [...foreground];
      return () => { for (const callback of queued) callback(); };
    },
  };
}

const session = (id: string): Conversation => ({
  conversation_id: id, name: id, type: 'nomi', created_at: 1, modified_at: 1,
});
const page = (items: Conversation[] = []): Paginated<Conversation> => ({ items, total: items.length, has_more: false });
const flush = async () => { for (let index = 0; index < 6; index += 1) await Promise.resolve(); };

describe('session snapshot synchronization', () => {
  it('subscribes to every delivery and foreground trigger before its initial snapshot', () => {
    const fixture = sourceFixture();
    let calls = 0;
    const stop = attachSessionSync(fixture.source, () => {
      expect(fixture.subscribedTopics()).toEqual(topics);
      expect(fixture.foregroundCount()).toBe(1);
      calls += 1;
    });
    expect(calls).toBe(1);
    stop();
  });

  it('reconciles the first ready, every supported change, reconnect and every foreground resume', () => {
    const fixture = sourceFixture();
    let calls = 0;
    const stop = attachSessionSync(fixture.source, () => { calls += 1; });
    for (const topic of topics) {
      const previous = calls;
      fixture.emit(topic, { conversation_id: 'any-session' });
      expect(calls).toBe(previous + 1);
    }
    fixture.resume();
    fixture.resume();
    expect(calls).toBe(10);
    fixture.emit('message.stream');
    expect(calls).toBe(10);
    stop();
  });

  it('unsubscribes once and ignores callbacks already queued by delivery or foreground sources', () => {
    const fixture = sourceFixture();
    let calls = 0;
    const stop = attachSessionSync(fixture.source, () => { calls += 1; });
    const queued = fixture.queuedTopic('conversation.listChanged');
    const foreground = fixture.queuedForeground();
    stop();
    stop();
    expect(fixture.subscribedTopics()).toEqual([]);
    expect(fixture.foregroundCount()).toBe(0);
    expect(fixture.removals()).toBe(8);
    for (const topic of topics) fixture.emit(topic);
    fixture.resume();
    queued();
    foreground();
    expect(calls).toBe(1);
  });

  it('releases partial subscriptions if attaching a source fails', () => {
    const fixture = sourceFixture();
    const failure = new Error('Foreground source unavailable');
    expect(() => attachSessionSync({ ...fixture.source, onForeground: () => { throw failure; } }, () => {})).toThrow(failure);
    expect(fixture.subscribedTopics()).toEqual([]);
    expect(fixture.removals()).toBe(7);
  });

  it('reads again when the first socket-ready and a creation event arrive during the initial delayed snapshot', async () => {
    const fixture = sourceFixture();
    const requests: { resolve: (result: Paginated<Conversation>) => void; signal: AbortSignal }[] = [];
    const catalog = createSessionCatalog({ epoch: 4, fetchPage: input => new Promise(resolve => {
      requests.push({ resolve, signal: input.signal });
    }) });
    const stop = attachSessionSync(fixture.source, catalog.markDirty);
    await flush();
    expect(requests).toHaveLength(1);
    fixture.emit('ws.ready');
    fixture.emit('conversation.listChanged', { conversation_id: 'created', action: 'created' });
    requests[0]!.resolve(page());
    await flush();
    expect(requests).toHaveLength(2);
    requests[1]!.resolve(page([session('created')]));
    await flush();
    expect(catalog.getSnapshot().items.map(item => item.conversation_id)).toEqual(['created']);
    expect(catalog.getSnapshot().isLoading).toBe(false);

    const queued = fixture.queuedTopic('turn.completed');
    const foreground = fixture.queuedForeground();
    stop();
    queued();
    foreground();
    fixture.resume();
    fixture.emit('ws.reconnected');
    await flush();
    expect(requests).toHaveLength(2);
    catalog.dispose();
  });

  it('an owner stopping during a delayed read cancels it and cannot start a recovery request', async () => {
    const fixture = sourceFixture();
    const requests: { resolve: (result: Paginated<Conversation>) => void; signal: AbortSignal }[] = [];
    const catalog = createSessionCatalog({ epoch: 5, fetchPage: input => new Promise(resolve => {
      requests.push({ resolve, signal: input.signal });
    }) });
    const stop = attachSessionSync(fixture.source, catalog.markDirty);
    await flush();
    fixture.emit('ws.ready');
    const queued = fixture.queuedTopic('conversation.listChanged');
    stop();
    catalog.dispose();
    expect(requests[0]!.signal.aborted).toBe(true);
    requests[0]!.resolve(page([session('late-old-connection')]));
    queued();
    fixture.resume();
    await flush();
    expect(requests).toHaveLength(1);
    expect(catalog.getSnapshot().items).toEqual([]);
  });
});
