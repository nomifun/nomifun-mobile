import { describe, expect, test } from 'bun:test';
import type { Conversation, Paginated } from '../api';
import { createSessionCatalog, type SessionCatalogPageRequest } from '../catalog';

const session = (id: string, patch: Partial<Conversation> = {}): Conversation => ({
  conversation_id: id,
  name: id,
  type: 'nomi',
  created_at: 1,
  modified_at: 1,
  ...patch,
});
const page = (items: Conversation[] = [], has_more = false): Paginated<Conversation> => ({
  items,
  has_more,
  total: items.length,
});
const ids = (items: Conversation[]) => items.map((item) => item.conversation_id);
const flush = async () => {
  // Drain promise continuations without timers or a React runtime.
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

function harness(epoch = 1) {
  const requests: Array<SessionCatalogPageRequest & {
    resolve: (value: Paginated<Conversation>) => void;
    reject: (error: unknown) => void;
  }> = [];
  const catalog = createSessionCatalog({
    epoch,
    fetchPage: (request) => new Promise((resolve, reject) => {
      requests.push({ ...request, resolve, reject });
    }),
  });
  return { catalog, requests };
}

describe('session catalog', () => {
  test('a successful empty snapshot is ready, with no pagination or loading footer', async () => {
    const { catalog, requests } = harness();
    expect(catalog.getSnapshot().isLoading).toBe(true);
    const initial = catalog.refresh();
    await flush();
    requests[0]!.resolve(page());
    await initial;
    expect(catalog.getSnapshot()).toMatchObject({
      items: [], isLoading: false, isLoadingMore: false, isRefreshing: false,
      hasMore: false, total: 0, error: undefined,
    });
    await catalog.loadMore();
    expect(requests).toHaveLength(1);
  });

  test('concurrent refreshes and continuous changes latch a serial follow-up read', async () => {
    const { catalog, requests } = harness();
    const initial = catalog.refresh();
    await flush();
    const concurrent = catalog.refresh();
    catalog.markDirty();
    catalog.markDirty();
    expect(concurrent).toBe(initial);
    expect(requests).toHaveLength(1);
    requests[0]!.resolve(page([session('first')]));
    await flush();
    expect(requests).toHaveLength(2);
    expect(ids(catalog.getSnapshot().items)).toEqual(['first']);
    catalog.markDirty();
    requests[1]!.resolve(page([session('second')]));
    await flush();
    expect(requests).toHaveLength(3);
    requests[2]!.resolve(page([session('latest')]));
    await initial;
    expect(ids(catalog.getSnapshot().items)).toEqual(['latest']);
    expect(catalog.getSnapshot().isRefreshing).toBe(false);
  });

  test('pagination is single-flight and retains server order while deduplicating ids', async () => {
    const { catalog, requests } = harness();
    const initial = catalog.refresh();
    await flush();
    requests[0]!.resolve(page([session('older'), session('pinned', { pinned: true })], true));
    await initial;
    const more = catalog.loadMore();
    expect(catalog.loadMore()).toBe(more);
    await flush();
    expect(requests).toHaveLength(2);
    expect(requests[1]!.cursor).toBe('pinned');
    expect(catalog.getSnapshot().isLoadingMore).toBe(true);
    requests[1]!.resolve(page([session('pinned'), session('last'), session('last')]));
    await more;
    expect(ids(catalog.getSnapshot().items)).toEqual(['older', 'pinned', 'last']);
    expect(catalog.getSnapshot().isLoadingMore).toBe(false);
    expect(catalog.getSnapshot().hasMore).toBe(false);
  });

  test('a failed older page keeps visible rows and can retry the same cursor', async () => {
    const { catalog, requests } = harness();
    const initial = catalog.refresh();
    await flush();
    requests[0]!.resolve(page([session('head')], true));
    await initial;
    const failed = catalog.loadMore();
    await flush();
    const failure = new Error('offline');
    requests[1]!.reject(failure);
    await failed;
    expect(catalog.getSnapshot()).toMatchObject({
      isLoadingMore: false, hasMore: true, error: failure,
    });
    expect(ids(catalog.getSnapshot().items)).toEqual(['head']);
    const retry = catalog.loadMore();
    await flush();
    expect(requests[2]!.cursor).toBe('head');
    expect(catalog.getSnapshot().error).toBeUndefined();
    requests[2]!.resolve(page([session('tail')]));
    await retry;
    expect(ids(catalog.getSnapshot().items)).toEqual(['head', 'tail']);
  });

  test('head refresh finishes independently of a slow older page and ignores its late response', async () => {
    const { catalog, requests } = harness();
    const initial = catalog.refresh();
    await flush();
    requests[0]!.resolve(page([session('old')], true));
    await initial;
    const oldPage = catalog.loadMore();
    await flush();
    const refresh = catalog.refresh();
    await flush();
    expect(requests[1]!.signal.aborted).toBe(true);
    expect(requests[2]!.cursor).toBeUndefined();
    expect(catalog.getSnapshot().isLoadingMore).toBe(false);
    requests[2]!.resolve(page([session('new')]));
    await refresh;
    expect(ids(catalog.getSnapshot().items)).toEqual(['new']);
    // The injected transport deliberately ignores cancellation.
    requests[1]!.resolve(page([session('obsolete-tail')], true));
    await oldPage;
    expect(ids(catalog.getSnapshot().items)).toEqual(['new']);
    expect(catalog.getSnapshot().hasMore).toBe(false);
  });

  test('refresh discards already loaded older pages without waiting to reload them', async () => {
    const { catalog, requests } = harness();
    const initial = catalog.refresh();
    await flush();
    requests[0]!.resolve(page([session('head')], true));
    await initial;
    const older = catalog.loadMore();
    await flush();
    requests[1]!.resolve(page([session('tail')]));
    await older;
    const refresh = catalog.refresh();
    await flush();
    expect(ids(catalog.getSnapshot().items)).toEqual(['head', 'tail']);
    requests[2]!.resolve(page([session('new-head')], true));
    await refresh;
    expect(ids(catalog.getSnapshot().items)).toEqual(['new-head']);
    expect(requests).toHaveLength(3);
  });

  test('a refresh cancels a queued older-page read before its transport starts', async () => {
    const { catalog, requests } = harness();
    const initial = catalog.refresh();
    await flush();
    requests[0]!.resolve(page([session('head')], true));
    await initial;
    const queued = catalog.loadMore();
    const refresh = catalog.refresh();
    await flush();
    expect(requests).toHaveLength(2);
    expect(requests[1]!.cursor).toBeUndefined();
    requests[1]!.resolve(page([session('new-head')]));
    await Promise.all([queued, refresh]);
    expect(ids(catalog.getSnapshot().items)).toEqual(['new-head']);
  });

  test('committed creation is visible immediately and an earlier GET cannot erase it', async () => {
    const { catalog, requests } = harness();
    const initial = catalog.refresh();
    await flush();
    catalog.upsert(session('created'));
    expect(ids(catalog.getSnapshot().items)).toEqual(['created']);
    requests[0]!.resolve(page());
    await flush();
    expect(ids(catalog.getSnapshot().items)).toEqual(['created']);
    expect(requests).toHaveLength(2);
    requests[1]!.resolve(page([session('created')]));
    await initial;
    expect(ids(catalog.getSnapshot().items)).toEqual(['created']);
  });

  test('committed deletion cannot be resurrected by an earlier snapshot', async () => {
    const { catalog, requests } = harness();
    catalog.upsert(session('deleted'));
    await flush();
    catalog.remove('deleted');
    expect(catalog.getSnapshot().items).toEqual([]);
    requests[0]!.resolve(page([session('deleted')]));
    await flush();
    expect(catalog.getSnapshot().items).toEqual([]);
    requests[1]!.resolve(page());
    await flush();
    expect(catalog.getSnapshot().items).toEqual([]);
    expect(catalog.getSnapshot().isRefreshing).toBe(false);
  });

  test('authoritative row snapshots replace runtime without persistent lifecycle overrides', async () => {
    const { catalog, requests } = harness();
    catalog.upsert(session('chat', { runtime: { is_processing: true, active_turn_id: 'turn' } }));
    await flush();
    requests[0]!.resolve(page([session('chat', { runtime: { is_processing: false } })]));
    await flush();
    expect(catalog.getSnapshot().items[0]!.runtime).toEqual({ is_processing: false });
  });

  test('observing a detail shares its entity without changing list membership or requesting a page', async () => {
    const { catalog, requests } = harness();
    const initial = catalog.refresh();
    await flush();
    requests[0]!.resolve({ ...page([session('listed')], true), total: 15 });
    await initial;
    const detail = session('detail', { runtime: { is_processing: true } });
    catalog.observe(detail);
    expect(catalog.getSnapshot().entities.detail).toBe(detail);
    expect(ids(catalog.getSnapshot().items)).toEqual(['listed']);
    expect(catalog.getSnapshot().total).toBe(15);
    expect(catalog.getSnapshot().hasMore).toBe(true);
    expect(requests).toHaveLength(1);
    const listed = session('listed', { runtime: { is_processing: false } });
    catalog.observe(listed);
    expect(catalog.getSnapshot().items[0]).toBe(listed);
    expect(catalog.getSnapshot().entities.listed).toBe(listed);
    const more = catalog.loadMore();
    await flush();
    expect(requests[1]!.cursor).toBe('listed');
    requests[1]!.resolve(page([session('tail')]));
    await more;
    expect(catalog.getSnapshot().entities.detail).toBe(detail);
    expect(catalog.getSnapshot().items[1]).toBe(catalog.getSnapshot().entities.tail);
  });

  test('a slow catalog snapshot cannot overwrite a detail observation made after the request began', async () => {
    const { catalog, requests } = harness();
    const initial = catalog.refresh();
    await flush();
    const observed = session('shared', { runtime: { is_processing: false } });
    catalog.observe(observed);
    requests[0]!.resolve(page([session('shared', { runtime: { is_processing: true } })]));
    await initial;
    expect(requests).toHaveLength(1);
    expect(catalog.getSnapshot().items).toEqual([observed]);
    expect(catalog.getSnapshot().entities.shared).toBe(observed);
    expect(catalog.getSnapshot().isLoading).toBe(false);
    catalog.remove('shared');
    expect(catalog.getSnapshot().entities.shared).toBeUndefined();
    await flush();
    requests[1]!.resolve(page());
    await flush();
  });

  test('first-load failures are errors, not an empty or loading-more state', async () => {
    const { catalog, requests } = harness();
    const initial = catalog.refresh();
    await flush();
    const failure = new Error('protocol mismatch');
    requests[0]!.reject(failure);
    await initial;
    expect(catalog.getSnapshot()).toMatchObject({
      items: [], isLoading: false, isLoadingMore: false, isRefreshing: false,
      hasMore: false, error: failure,
    });
  });

  test('a connection epoch change disposes requests and isolates late responses and notifications', async () => {
    const previous = harness(10);
    const current = harness(11);
    let notifications = 0;
    previous.catalog.subscribe(() => { notifications += 1; });
    const oldRead = previous.catalog.refresh();
    await flush();
    previous.catalog.dispose();
    const atDisposal = notifications;
    expect(previous.requests[0]!.signal.aborted).toBe(true);
    const newRead = current.catalog.refresh();
    await flush();
    expect(previous.requests[0]!.epoch).toBe(10);
    expect(current.requests[0]!.epoch).toBe(11);
    current.requests[0]!.resolve(page([session('current-desktop')]));
    await newRead;
    previous.requests[0]!.resolve(page([session('old-desktop')]));
    await oldRead;
    previous.catalog.upsert(session('late-mutation'));
    previous.catalog.markDirty();
    await previous.catalog.loadMore();
    expect(notifications).toBe(atDisposal);
    expect(previous.requests).toHaveLength(1);
    expect(ids(current.catalog.getSnapshot().items)).toEqual(['current-desktop']);
  });
});
