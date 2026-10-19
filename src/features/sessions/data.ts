import { ApiError, StaleConnectionError } from '@/api/types';
import type { Conversation, ConversationListOptions, Paginated, SessionReadOptions } from './api';
import { createSessionCatalog, type SessionCatalogSnapshot } from './catalog';
import type { CreateConversationOptions, CreatedConversation } from './commands';

export interface SessionDetailState {
  loading: boolean;
  error: unknown;
}

export interface SessionDataSnapshot extends SessionCatalogSnapshot {
  creating: boolean;
  details: Readonly<Record<string, SessionDetailState>>;
}

export interface SessionMetadataUpdate {
  name?: string;
  pinned?: boolean;
  archived?: boolean;
}

export interface SessionModelSelection {
  providerId: string;
  model: string;
}

export interface SessionDataOptions {
  epoch: number;
  currentEpoch: () => number;
  fetchPage: (options: ConversationListOptions) => Promise<Paginated<Conversation>>;
  fetchOne: (id: string, options: SessionReadOptions) => Promise<Conversation>;
  create: (name: string | undefined, options: CreateConversationOptions) => Promise<CreatedConversation>;
  patch: (id: string, updates: SessionMetadataUpdate, options: SessionReadOptions) => Promise<Conversation>;
  remove: (id: string, options: SessionReadOptions) => Promise<unknown>;
  setModel: (id: string, selection: SessionModelSelection, options: SessionReadOptions) => Promise<Conversation>;
}

export interface SessionData {
  getSnapshot: () => SessionDataSnapshot;
  subscribe: (listener: () => void) => () => void;
  refresh: () => Promise<void>;
  markDirty: () => void;
  loadMore: () => Promise<void>;
  watchDetail: (id: string) => () => void;
  reloadDetail: (id: string) => Promise<Conversation | undefined>;
  reconcile: () => void;
  create: (name?: string, options?: { workspace?: string }) => Promise<CreatedConversation>;
  patch: (id: string, updates: SessionMetadataUpdate) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setModel: (id: string, selection: SessionModelSelection) => Promise<void>;
  dispose: () => void;
}

interface DetailRead {
  abort: AbortController;
  generation: number;
  committedCreation: boolean;
  promise: Promise<Conversation | undefined>;
}

/** One connection owns the list and every detail consumer's canonical entities. */
export function createSessionData(options: SessionDataOptions): SessionData {
  const listeners = new Set<() => void>();
  const watchers = new Map<string, number>();
  const reads = new Map<string, DetailRead>();
  const generations = new Map<string, number>();
  const mutationTails = new Map<string, Promise<void>>();
  const mutationAborts = new Set<AbortController>();
  const creationKeys = new Map<string, string>();
  const pendingCreated = new Set<string>();
  let details = Object.create(null) as Record<string, SessionDetailState>;
  let disposed = false;
  let creating = false;
  let creation: { signature: string; promise: Promise<CreatedConversation> } | undefined;
  const isCurrent = () => !disposed && options.currentEpoch() === options.epoch;
  const assertCurrent = () => { if (!isCurrent()) throw new StaleConnectionError(); };
  const catalog = createSessionCatalog({
    epoch: options.epoch,
    fetchPage: async ({ cursor, signal }) => {
      assertCurrent();
      const page = await options.fetchPage({ cursor, signal, expectedEpoch: options.epoch });
      assertCurrent();
      return page;
    },
  });
  const buildSnapshot = (): SessionDataSnapshot => Object.assign(Object.create(null), catalog.getSnapshot(), {
    creating,
    details,
  });
  let snapshot = buildSnapshot();
  const publish = () => {
    if (!isCurrent()) return;
    snapshot = buildSnapshot();
    for (const listener of listeners) listener();
  };
  const unsubscribeCatalog = catalog.subscribe(publish);
  const setDetail = (id: string, loading: boolean, error: unknown) => {
    if (!isCurrent()) return;
    details = Object.assign(Object.create(null), details) as Record<string, SessionDetailState>;
    details[id] = { loading, error };
    publish();
  };
  const invalidateDetail = (id: string) => {
    generations.set(id, (generations.get(id) ?? 0) + 1);
    reads.get(id)?.abort.abort();
    reads.delete(id);
  };

  const reloadDetail = (id: string, committedCreation = false): Promise<Conversation | undefined> => {
    if (!isCurrent()) return Promise.resolve(undefined);
    // Navigation may subscribe while creation's projection is still loading.
    // Replacing that read must preserve its committed list-membership intent.
    const shouldUpsert = committedCreation || pendingCreated.has(id) || reads.get(id)?.committedCreation === true;
    invalidateDetail(id);
    const generation = generations.get(id)!;
    const abort = new AbortController();
    const valid = () => isCurrent() && !abort.signal.aborted && generations.get(id) === generation;
    const promise = Promise.resolve().then(async () => {
      if (!valid()) return undefined;
      try {
        const row = await options.fetchOne(id, { expectedEpoch: options.epoch, signal: abort.signal });
        if (!valid()) return undefined;
        if (shouldUpsert) {
          catalog.upsert(row);
          pendingCreated.delete(id);
        }
        else catalog.observe(row);
        setDetail(id, false, undefined);
        return row;
      } catch (error) {
        if (valid()) setDetail(id, false, error);
        return undefined;
      } finally {
        if (reads.get(id)?.generation === generation) reads.delete(id);
      }
    });
    reads.set(id, { abort, generation, committedCreation: shouldUpsert, promise });
    setDetail(id, true, undefined);
    return promise;
  };

  const markDirty = () => { if (isCurrent()) catalog.markDirty(); };
  const mutate = (id: string, command: (request: SessionReadOptions) => Promise<Conversation | undefined>): Promise<void> => {
    if (!isCurrent()) return Promise.reject(new StaleConnectionError());
    // Commands for one Session commit in invocation order. A slower PATCH must
    // not resurrect a Session whose later DELETE has already completed.
    const previous = mutationTails.get(id) ?? Promise.resolve();
    const task = previous.then(async () => {
      assertCurrent();
      const abort = new AbortController();
      mutationAborts.add(abort);
      try {
        const row = await command({ expectedEpoch: options.epoch, signal: abort.signal });
        assertCurrent();
        invalidateDetail(id);
        if (row) catalog.upsert(row);
        else catalog.remove(id);
        pendingCreated.delete(id);
        setDetail(id, false, undefined);
      } catch (error) {
        if (isCurrent()) setDetail(id, false, error);
        throw error;
      } finally {
        mutationAborts.delete(abort);
      }
    });
    const tail = task.then(() => undefined, () => undefined);
    mutationTails.set(id, tail);
    void tail.then(() => { if (mutationTails.get(id) === tail) mutationTails.delete(id); });
    return task;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh: () => isCurrent() ? catalog.refresh() : Promise.resolve(),
    markDirty,
    loadMore: () => isCurrent() ? catalog.loadMore() : Promise.resolve(),
    watchDetail: (id) => {
      if (!isCurrent()) return () => undefined;
      const count = watchers.get(id) ?? 0;
      watchers.set(id, count + 1);
      if (count === 0 && !reads.has(id)) void reloadDetail(id);
      let watching = true;
      return () => {
        if (!watching) return;
        watching = false;
        const remaining = (watchers.get(id) ?? 1) - 1;
        if (remaining > 0) watchers.set(id, remaining);
        else {
          watchers.delete(id);
          if (reads.has(id) && !reads.get(id)!.committedCreation) {
            invalidateDetail(id);
            setDetail(id, false, details[id]?.error);
          }
        }
      };
    },
    reloadDetail: (id) => reloadDetail(id),
    reconcile: () => {
      if (!isCurrent()) return;
      markDirty();
      for (const id of watchers.keys()) void reloadDetail(id);
    },
    create: (name, input = {}) => {
      if (!isCurrent()) return Promise.reject(new StaleConnectionError());
      const workspace = input.workspace?.trim();
      const signature = JSON.stringify([name ?? '', workspace ?? '']);
      if (creation) {
        return creation.signature === signature ? creation.promise : Promise.reject(new ApiError(
          'Another session creation is still in progress', 409, 'SESSION_CREATION_BUSY',
        ));
      }
      let key = creationKeys.get(signature);
      if (!key) {
        key = Array.from({ length: 4 }, () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0')).join('');
        creationKeys.set(signature, key);
      }
      const idempotencyKey = key;
      const promise = Promise.resolve().then(async () => {
        assertCurrent();
        const receipt = await options.create(name, { workspace, expectedEpoch: options.epoch, idempotencyKey });
        assertCurrent();
        if (receipt.epoch !== options.epoch) throw new StaleConnectionError();
        creationKeys.delete(signature);
        pendingCreated.add(receipt.conversation_id);
        // POST's durable receipt owns success. Subsequent read failures belong
        // to list/detail state and must never invite another creation intent.
        markDirty();
        void reloadDetail(receipt.conversation_id, true);
        return receipt;
      }).finally(() => {
        if (creation?.promise === promise) {
          creation = undefined;
          creating = false;
          publish();
        }
      });
      creation = { signature, promise };
      creating = true;
      publish();
      return promise;
    },
    patch: (id, updates) => mutate(id, (request) => options.patch(id, updates, request)),
    remove: (id) => mutate(id, async (request) => { await options.remove(id, request); return undefined; }),
    setModel: (id, selection) => mutate(id, (request) => options.setModel(id, selection, request)),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribeCatalog();
      catalog.dispose();
      for (const read of reads.values()) read.abort.abort();
      for (const abort of mutationAborts) abort.abort();
      reads.clear();
      watchers.clear();
      listeners.clear();
      creationKeys.clear();
      pendingCreated.clear();
    },
  };
}
