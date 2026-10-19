import type { Conversation, Paginated } from './api';

export interface SessionCatalogSnapshot {
  items: Conversation[];
  entities: Readonly<Record<string, Conversation>>;
  total: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  isRefreshing: boolean;
  hasMore: boolean;
  error: unknown;
}

export interface SessionCatalogPageRequest {
  cursor?: string;
  signal: AbortSignal;
  epoch: number;
}

export interface SessionCatalogOptions {
  /** A catalog belongs to exactly one connection. Dispose it when that changes. */
  epoch: number;
  fetchPage: (request: SessionCatalogPageRequest) => Promise<Paginated<Conversation>>;
}

export interface SessionCatalog {
  getSnapshot: () => SessionCatalogSnapshot;
  subscribe: (listener: () => void) => () => void;
  refresh: () => Promise<void>;
  markDirty: () => void;
  loadMore: () => Promise<void>;
  /** Apply an already committed server projection, then reconcile its position. */
  upsert: (conversation: Conversation) => void;
  /** Publish a read projection without adding it to the current list window. */
  observe: (conversation: Conversation) => void;
  remove: (conversationId: string) => void;
  dispose: () => void;
}

function uniqueItems(items: readonly Conversation[]): Conversation[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.conversation_id)) return false;
    seen.add(item.conversation_id);
    return true;
  });
}

/**
 * The server owns the order and runtime on every row. This store owns only the
 * transport lifecycle: one head reconciliation, one optional older-page read,
 * and a dirty latch for changes that arrive during a reconciliation.
 */
export function createSessionCatalog(options: SessionCatalogOptions): SessionCatalog {
  const listeners = new Set<() => void>();
  let listIds: string[] = [];
  let entities = Object.create(null) as Record<string, Conversation>;
  let total = 0;
  let entityGeneration = 0;
  const entityVersions = new Map<string, number>();
  let settled = false;
  let error: unknown;
  let hasMore = false;
  let cursor: string | undefined;
  let disposed = false;
  let dirty = false;
  let headPromise: Promise<void> | undefined;
  let headAbort: AbortController | undefined;
  let pagePromise: Promise<void> | undefined;
  let pageAbort: AbortController | undefined;
  let pageGeneration = 0;
  // A GET started before a committed mutation must not erase or resurrect it.
  let commitGeneration = 0;

  const buildSnapshot = (): SessionCatalogSnapshot => ({
    items: listIds.map((id) => entities[id]!),
    entities,
    total,
    isLoading: !settled && error === undefined,
    isLoadingMore: pageAbort !== undefined,
    isRefreshing: headPromise !== undefined && settled,
    hasMore,
    error,
  });
  let snapshot = buildSnapshot();

  const publish = () => {
    if (disposed) return;
    snapshot = buildSnapshot();
    for (const listener of listeners) listener();
  };

  const discardPagination = () => {
    pageGeneration += 1;
    pageAbort?.abort();
    pageAbort = undefined;
    pagePromise = undefined;
    cursor = undefined;
    hasMore = false;
  };

  const writeRows = (rows: readonly Conversation[], requestGeneration = entityGeneration) => {
    const next = Object.assign(Object.create(null), entities) as Record<string, Conversation>;
    for (const row of uniqueItems(rows)) {
      // A detail read/committed mutation published after this GET began is
      // newer local knowledge. Accept the page membership without erasing it.
      if ((entityVersions.get(row.conversation_id) ?? 0) > requestGeneration) continue;
      next[row.conversation_id] = row;
      entityVersions.set(row.conversation_id, ++entityGeneration);
    }
    entities = next;
  };

  const reconcile = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    dirty = true;
    discardPagination();
    error = undefined;
    if (!headPromise) {
      // Schedule after assigning the promise so subscribers can safely request
      // another refresh while receiving the loading notification.
      headPromise = Promise.resolve().then(async () => {
        try {
          while (dirty && !disposed) {
            dirty = false;
            const generation = commitGeneration;
            const readGeneration = entityGeneration;
            const abort = new AbortController();
            headAbort = abort;
            try {
              const page = await options.fetchPage({ signal: abort.signal, epoch: options.epoch });
              if (disposed || abort.signal.aborted || generation !== commitGeneration) continue;
              writeRows(page.items, readGeneration);
              listIds = uniqueItems(page.items).map((row) => row.conversation_id);
              total = page.total;
              cursor = page.items.at(-1)?.conversation_id;
              hasMore = page.has_more && cursor !== undefined;
              settled = true;
              error = undefined;
              publish();
            } catch (failure) {
              if (!disposed && !abort.signal.aborted && generation === commitGeneration) {
                error = failure;
                publish();
              }
            } finally {
              if (headAbort === abort) headAbort = undefined;
            }
          }
        } finally {
          headPromise = undefined;
          publish();
        }
      });
    }
    publish();
    return headPromise;
  };

  const loadMore = (): Promise<void> => {
    if (disposed || headPromise || !hasMore || !cursor) return Promise.resolve();
    if (pagePromise) return pagePromise;
    const generation = pageGeneration;
    const readGeneration = entityGeneration;
    const abort = new AbortController();
    const nextCursor = cursor;
    pageAbort = abort;
    error = undefined;
    pagePromise = Promise.resolve().then(async () => {
      try {
        if (disposed || abort.signal.aborted || generation !== pageGeneration) return;
        const page = await options.fetchPage({ cursor: nextCursor, signal: abort.signal, epoch: options.epoch });
        if (disposed || abort.signal.aborted || generation !== pageGeneration) return;
        writeRows(page.items, readGeneration);
        listIds = [...new Set([...listIds, ...page.items.map((row) => row.conversation_id)])];
        total = page.total;
        cursor = page.items.at(-1)?.conversation_id;
        hasMore = page.has_more && cursor !== undefined && cursor !== nextCursor;
        error = undefined;
      } catch (failure) {
        if (!disposed && !abort.signal.aborted && generation === pageGeneration) error = failure;
      } finally {
        if (pageAbort === abort) {
          pageAbort = undefined;
          pagePromise = undefined;
          publish();
        }
      }
    });
    publish();
    return pagePromise;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh: reconcile,
    markDirty: () => { void reconcile(); },
    loadMore,
    upsert: (conversation) => {
      if (disposed) return;
      commitGeneration += 1;
      writeRows([conversation]);
      if (!listIds.includes(conversation.conversation_id)) {
        listIds = [conversation.conversation_id, ...listIds];
        total = Math.max(total, listIds.length);
      }
      settled = true;
      void reconcile();
    },
    observe: (conversation) => {
      if (disposed) return;
      writeRows([conversation]);
      publish();
    },
    remove: (conversationId) => {
      if (disposed) return;
      commitGeneration += 1;
      if (listIds.includes(conversationId)) total = Math.max(0, total - 1);
      listIds = listIds.filter((id) => id !== conversationId);
      const next = Object.assign(Object.create(null), entities) as Record<string, Conversation>;
      delete next[conversationId];
      entities = next;
      entityVersions.set(conversationId, ++entityGeneration);
      void reconcile();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      dirty = false;
      headAbort?.abort();
      discardPagination();
      listeners.clear();
    },
  };
}
