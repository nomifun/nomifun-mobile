/**
 * SWR + WebSocket wiring for the session feature.
 *
 * Two hooks:
 * - `useConversationList()` — cursor-paginated list, kept live by
 *   `conversation.listChanged` / `turn.*`, re-snapshotted on `ws.reconnected`.
 * - `useChatSession(id)` — newest history window + older pages + the live
 *   `message.stream` tail, with optimistic send and stop.
 *
 * The server never replays WS frames, so every reconnect refetches.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';

import { useWsTopic } from '@/hooks/use-ws';

import {
  CONVERSATION_PAGE_SIZE,
  cancelTurn,
  conversationPath,
  conversationsPath,
  fetchMessages,
  messagesPath,
  olderCursor,
  postMessage,
  type Conversation,
  type Paginated,
  type StoredMessage,
} from './api';
import {
  compareMessages,
  dedupeKey,
  fromStoredMessage,
  reduceStreamFrame,
  type ChatMessage,
  type StreamFrame,
} from './stream';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function conversationIdOf(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  const id = data.conversation_id;
  return typeof id === 'string' ? id : undefined;
}

/** Coalesce event bursts into a single refetch. */
function useDebouncedCallback(fn: () => void, delay: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      fnRef.current();
    }, delay);
  }, [delay]);
}

// ── Session list ───────────────────────────────────────────────────

export interface ConversationListState {
  items: Conversation[];
  isLoading: boolean;
  isLoadingMore: boolean;
  isRefreshing: boolean;
  hasMore: boolean;
  error: unknown;
  /** True while the conversation's runtime is producing a turn. */
  isGenerating: (conversationId: string) => boolean;
  loadMore: () => void;
  refresh: () => Promise<unknown>;
  retry: () => void;
}

export function useConversationList(): ConversationListState {
  const getKey = (index: number, previous: Paginated<Conversation> | null) => {
    if (index === 0) return conversationsPath();
    if (!previous || !previous.has_more) return null;
    const last = previous.items[previous.items.length - 1];
    if (!last) return null;
    return conversationsPath(last.conversation_id);
  };

  const { data, error, isLoading, isValidating, size, setSize, mutate } = useSWRInfinite<
    Paginated<Conversation>
  >(getKey, { revalidateFirstPage: true, parallel: false });

  const [refreshing, setRefreshing] = useState(false);
  /** turn.started/turn.completed overrides on top of each row's runtime. */
  const [generating, setGenerating] = useState<Record<string, boolean>>({});

  const refetch = useDebouncedCallback(() => {
    void mutate();
  }, 250);

  useWsTopic(['conversation.listChanged', 'ws.reconnected'], () => refetch());

  useWsTopic('turn.started', (payload) => {
    const id = conversationIdOf(payload);
    if (!id) return;
    setGenerating((prev) => ({ ...prev, [id]: true }));
  });

  useWsTopic('turn.completed', (payload) => {
    const id = conversationIdOf(payload);
    if (!id) return;
    setGenerating((prev) => ({ ...prev, [id]: false }));
    refetch();
  });

  const items = useMemo(() => {
    const out: Conversation[] = [];
    const seen = new Set<string>();
    for (const page of data ?? []) {
      for (const row of page?.items ?? []) {
        if (seen.has(row.conversation_id)) continue;
        seen.add(row.conversation_id);
        out.push(row);
      }
    }
    // The server orders by `modified_at` only, so a pinned row sinks as soon as
    // any other conversation sees activity. Mirror the desktop sidebar: pinned
    // first (newest pin on top), then last activity.
    return out.sort(
      (a, b) =>
        Number(b.pinned === true) - Number(a.pinned === true) ||
        (a.pinned === true ? (b.pinned_at ?? 0) - (a.pinned_at ?? 0) : 0) ||
        b.modified_at - a.modified_at,
    );
  }, [data]);

  const lastPage = data && data.length > 0 ? data[data.length - 1] : undefined;
  const isLoadingMore = size > 0 && !!data && data.length === size && data[size - 1] === undefined;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await setSize(1);
      return await mutate();
    } finally {
      setRefreshing(false);
    }
  }, [mutate, setSize]);

  const isGenerating = useCallback(
    (conversationId: string) => {
      const override = generating[conversationId];
      if (override !== undefined) return override;
      const row = items.find((item) => item.conversation_id === conversationId);
      return row?.runtime?.is_processing === true;
    },
    [generating, items],
  );

  return {
    items,
    isLoading: isLoading && !data,
    isLoadingMore: isLoadingMore || (isValidating && !!data && data.length < size),
    isRefreshing: refreshing,
    hasMore: lastPage?.has_more === true,
    error,
    isGenerating,
    loadMore: () => {
      if (lastPage?.has_more && !isLoadingMore) void setSize(size + 1);
    },
    refresh,
    retry: () => void mutate(),
  };
}

/** Single conversation row (header title, model chip, runtime state). */
export function useConversation(conversationId: string | undefined) {
  const key = conversationId ? conversationPath(conversationId) : null;
  const swr = useSWR<Conversation>(key);
  useWsTopic('ws.reconnected', () => {
    void swr.mutate();
  });
  useWsTopic('conversation.listChanged', (payload) => {
    if (conversationIdOf(payload) === conversationId) void swr.mutate();
  });
  return swr;
}

// ── Chat detail ────────────────────────────────────────────────────

interface OlderState {
  rows: StoredMessage[];
  hasMore: boolean | null;
}

export interface ChatSessionState {
  messages: ChatMessage[];
  isLoading: boolean;
  error: unknown;
  isRefreshing: boolean;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  /** A turn is producing output right now. */
  streaming: boolean;
  /** Server-reported composer enablement (`runtime.can_send_message`). */
  canSend: boolean;
  refresh: () => Promise<unknown>;
  retry: () => void;
  loadOlder: () => void;
  /** Appends an optimistic bubble; throws (and rolls it back) on failure. */
  send: (text: string) => Promise<void>;
  stop: () => Promise<void>;
}

let localSeq = 0;

export function useChatSession(
  conversationId: string | undefined,
  conversation: Conversation | undefined,
): ChatSessionState {
  const key = conversationId ? messagesPath(conversationId, '') : null;
  const { data, error, isLoading, mutate } = useSWR<Paginated<StoredMessage>>(key);

  const [older, setOlder] = useState<OlderState>({ rows: [], hasMore: null });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [live, setLive] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [runtimeCanSend, setRuntimeCanSend] = useState<boolean | null>(null);
  /** Once a turn.completed lands, WS is authoritative over the durable row. */
  const sawCompletion = useRef(false);

  // Switching conversations resets every per-chat projection.
  useEffect(() => {
    setOlder({ rows: [], hasMore: null });
    setLive([]);
    setStreaming(false);
    setRuntimeCanSend(null);
    sawCompletion.current = false;
  }, [conversationId]);

  // Adopt the durable runtime snapshot on first load. Ignored afterwards: a
  // row fetch that was already in flight when the turn ended would otherwise
  // resurrect the "generating" state with no further event to clear it.
  useEffect(() => {
    if (sawCompletion.current) return;
    if (conversation?.runtime?.is_processing === true) setStreaming(true);
  }, [conversation?.runtime]);

  /** Refetch the newest window, then drop live bubbles the server now owns. */
  const reconcile = useCallback(async () => {
    const fresh = await mutate();
    const owned = new Set<string>();
    for (const row of fresh?.items ?? []) {
      if (row.msg_id) owned.add(dedupeKey(row.msg_id, row.type as ChatMessage['type']));
    }
    if (owned.size > 0) {
      setLive((prev) => prev.filter((m) => !m.msgId || !owned.has(dedupeKey(m.msgId, m.type))));
    }
    return fresh;
  }, [mutate]);

  const reconcileSoon = useDebouncedCallback(() => {
    void reconcile();
  }, 400);

  useWsTopic('message.stream', (payload) => {
    if (!conversationId || conversationIdOf(payload) !== conversationId) return;
    const frame = payload as StreamFrame;
    setLive((prev) => reduceStreamFrame(prev, frame));
    if (frame.stream_complete !== true && frame.type !== 'finish') setStreaming(true);
    if (frame.type === 'finish') setStreaming(false);
  });

  useWsTopic('message.userCreated', (payload) => {
    if (!conversationId || conversationIdOf(payload) !== conversationId) return;
    if (!isRecord(payload)) return;
    const msgId = typeof payload.msg_id === 'string' ? payload.msg_id : undefined;
    const body = typeof payload.content === 'string' ? payload.content : '';
    const createdAt = typeof payload.created_at === 'number' ? payload.created_at : Date.now();
    if (payload.hidden === true) return;
    setLive((prev) => {
      if (msgId && prev.some((m) => m.msgId === msgId && m.type === 'text')) return prev;
      const pendingAt = prev.findIndex(
        (m) =>
          m.pending &&
          m.position === 'right' &&
          (!body || (isRecord(m.content) && m.content.content === body)),
      );
      if (pendingAt >= 0) {
        const next = [...prev];
        next[pendingAt] = { ...next[pendingAt], msgId, pending: false };
        return next;
      }
      return [
        ...prev,
        {
          key: msgId ? dedupeKey(msgId, 'text') : `user-${++localSeq}`,
          msgId,
          type: 'text' as const,
          content: { content: body },
          position: 'right' as const,
          createdAt,
        },
      ];
    });
  });

  useWsTopic('turn.started', (payload) => {
    if (!conversationId || conversationIdOf(payload) !== conversationId) return;
    setStreaming(true);
    setRuntimeCanSend(false);
  });

  useWsTopic('turn.completed', (payload) => {
    if (!conversationId || conversationIdOf(payload) !== conversationId) return;
    sawCompletion.current = true;
    setStreaming(false);
    const runtime = isRecord(payload) && isRecord(payload.runtime) ? payload.runtime : undefined;
    const canSend =
      (isRecord(payload) && typeof payload.can_send_message === 'boolean'
        ? payload.can_send_message
        : undefined) ??
      (typeof runtime?.can_send_message === 'boolean' ? runtime.can_send_message : undefined) ??
      true;
    setRuntimeCanSend(canSend);
    reconcileSoon();
  });

  // No server-side replay: re-snapshot history and drop every optimistic
  // projection, including the composer lock (a missed turn.completed must not
  // strand the input in a disabled state).
  useWsTopic('ws.reconnected', () => {
    if (!conversationId) return;
    setLive([]);
    setStreaming(false);
    setRuntimeCanSend(null);
    sawCompletion.current = false;
    void mutate();
  });

  const history = useMemo(() => {
    const rows = [...older.rows, ...(data?.items ?? [])];
    const seen = new Set<string>();
    const out: StoredMessage[] = [];
    for (const row of rows) {
      if (seen.has(row.message_id)) continue;
      seen.add(row.message_id);
      out.push(row);
    }
    return out;
  }, [older.rows, data?.items]);

  const messages = useMemo(() => {
    const out: ChatMessage[] = [];
    const owned = new Set<string>();
    for (const row of history) {
      const message = fromStoredMessage(row);
      if (!message) continue;
      out.push(message);
      if (message.msgId) owned.add(dedupeKey(message.msgId, message.type));
    }
    for (const message of live) {
      if (message.msgId && owned.has(dedupeKey(message.msgId, message.type))) continue;
      out.push(message);
    }
    return out.sort(compareMessages);
  }, [history, live]);

  const hasOlder = older.hasMore ?? data?.has_more ?? false;

  const loadOlder = useCallback(() => {
    if (!conversationId || loadingOlder || !hasOlder) return;
    const oldest = older.rows[0] ?? data?.items[0];
    const cursor = olderCursor(oldest);
    if (!cursor) return;
    setLoadingOlder(true);
    void fetchMessages(conversationId, cursor)
      .then((page) => {
        setOlder((prev) => ({ rows: [...page.items, ...prev.rows], hasMore: page.has_more }));
      })
      .catch(() => {
        // Keep the current window; the user can retry by scrolling again.
      })
      .finally(() => setLoadingOlder(false));
  }, [conversationId, data?.items, hasOlder, loadingOlder, older.rows]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setOlder({ rows: [], hasMore: null });
      return await reconcile();
    } finally {
      setRefreshing(false);
    }
  }, [reconcile]);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!conversationId || !content) return;
      const localKey = `local-${++localSeq}`;
      setLive((prev) => [
        ...prev,
        {
          key: localKey,
          type: 'text' as const,
          content: { content },
          position: 'right' as const,
          createdAt: Date.now(),
          pending: true,
        },
      ]);
      setStreaming(true);
      try {
        const result = await postMessage(conversationId, content);
        setLive((prev) =>
          prev.map((m) =>
            m.key === localKey
              ? { ...m, pending: false, msgId: m.msgId ?? result?.msg_id, key: localKey }
              : m,
          ),
        );
      } catch (err) {
        setLive((prev) => prev.filter((m) => m.key !== localKey));
        setStreaming(false);
        throw err;
      }
    },
    [conversationId],
  );

  const stop = useCallback(async () => {
    if (!conversationId) return;
    await cancelTurn(conversationId);
    setStreaming(false);
  }, [conversationId]);

  return {
    messages,
    isLoading: isLoading && !data,
    error,
    isRefreshing: refreshing,
    hasOlder,
    isLoadingOlder: loadingOlder,
    streaming,
    canSend: runtimeCanSend ?? conversation?.runtime?.can_send_message ?? true,
    refresh,
    retry: () => void mutate(),
    loadOlder,
    send,
    stop,
  };
}

export { CONVERSATION_PAGE_SIZE };
