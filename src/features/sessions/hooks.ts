/**
 * SWR + WebSocket wiring for the session feature.
 *
 * Two hooks:
 * - `useConversationList()` — cursor-paginated list, kept live by
 *   `conversation.listChanged` / `turn.*`, re-snapshotted on `ws.reconnected`,
 *   plus the project sections derived from every loaded page.
 * - `useChatSession(id)` — newest history window + older pages + the live
 *   `message.stream` tail, with optimistic send and stop.
 *
 * The server never replays WS frames, so every reconnect refetches.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { connectionStorageKey, connectionStore } from '@/api/connection';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';

import { ApiError } from '@/api/types';
import { useWsTopic } from '@/hooks/use-ws';
import i18n from '@/i18n';

import {
  CONVERSATION_PAGE_SIZE,
  cancelTurn,
  conversationPath,
  conversationsPath,
  fetchMessages,
  messagesPath,
  newIdempotencyKey,
  olderCursor,
  postMessage,
  type Conversation,
  type Paginated,
  type StoredMessage,
  type SendMessageResult,
} from './api';
import { cancelObservedTurn } from './turn-cancel';
import { buildMessageContent, parseMessageContent } from './attachments';
import {
  compareMessages,
  dedupeKey,
  fromStoredMessage,
  reduceStreamFrame,
  shouldOpenStreamingForFrame,
  textBody,
  type ChatMessage,
  type StreamFrame,
} from './stream';
import { buildConversationGroups, type ConversationGroup } from './workpath';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function conversationIdOf(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  const id = data.conversation_id;
  return typeof id === 'string' ? id : undefined;
}

/** `agentSession.*` events name the session by its canonical id field. */
function agentSessionIdOf(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  const id = data.agent_session_id;
  return typeof id === 'string' ? id : undefined;
}

function turnIdOf(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  const id = data.turn_id;
  return typeof id === 'string' && id.trim() ? id : undefined;
}

function rememberCompletedTurn(turns: Set<string>, turnId: string | undefined): void {
  if (!turnId) return;
  turns.add(turnId);
  while (turns.size > 32) {
    const oldest = turns.values().next().value;
    if (typeof oldest !== 'string') break;
    turns.delete(oldest);
  }
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
  /**
   * `items` bucketed by workpath: the default node first, then one section per
   * project directory. Derived from every page loaded so far, so paging in more
   * rows grows the existing sections instead of appending a flat tail.
   */
  groups: ConversationGroup[];
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

interface GeneratingOverride {
  value: boolean;
  turnId?: string;
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
  const [generating, setGenerating] = useState<
    Record<string, GeneratingOverride>
  >({});

  const refetch = useDebouncedCallback(() => {
    void mutate();
  }, 250);

  useWsTopic('conversation.listChanged', () => refetch());
  // An agent/knowledge switch performed on the desktop rewrites the row's
  // name/model metadata without emitting conversation.listChanged.
  useWsTopic('agentSession.agentChanged', () => refetch());
  useWsTopic('ws.reconnected', () => {
    // A completion frame may have been lost while the socket was down. The
    // row snapshot is authoritative, so discard local lifecycle overrides
    // before re-reading it.
    setGenerating({});
    refetch();
  });

  useWsTopic('turn.started', (payload) => {
    const id = conversationIdOf(payload);
    if (!id) return;
    const runtime = isRecord(payload) && isRecord(payload.runtime)
      ? payload.runtime
      : undefined;
    const processing =
      (typeof runtime?.is_processing === 'boolean'
        ? runtime.is_processing
        : undefined) ??
      (isRecord(payload) && typeof payload.is_processing === 'boolean'
        ? payload.is_processing
        : true);
    const activeTurnId =
      typeof runtime?.active_turn_id === 'string'
        ? runtime.active_turn_id
        : isRecord(payload) && typeof payload.turn_id === 'string'
          ? payload.turn_id
          : undefined;
    const turnId =
      turnIdOf(payload);
    if (processing && (!turnId || !activeTurnId || activeTurnId === turnId)) {
      setGenerating((prev) => ({
        ...prev,
        [id]: { value: true, turnId: activeTurnId ?? turnId },
      }));
    }
  });

  useWsTopic('turn.completed', (payload) => {
    const id = conversationIdOf(payload);
    if (!id) return;
    const turnId = turnIdOf(payload);
    setGenerating((prev) => {
      const current = prev[id];
      if (
        current?.value === true &&
        current.turnId &&
        turnId &&
        current.turnId !== turnId
      ) {
        return prev;
      }
      return { ...prev, [id]: { value: false, turnId } };
    });
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

  // Grouping runs on the whole loaded set (not per page) and inherits the sort
  // above, so pinned-first / modified_at-desc holds inside every section.
  const groups = useMemo(() => buildConversationGroups(items), [items]);

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
      if (override !== undefined) return override.value;
      const row = items.find((item) => item.conversation_id === conversationId);
      return row?.runtime?.is_processing === true;
    },
    [generating, items],
  );

  return {
    items,
    groups,
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

const COLLAPSED_STORAGE_KEY = 'nomifun:session-list-collapsed-workpaths:v1';

export interface CollapsedWorkpaths {
  /** `true` for a collapsed section key; absent means expanded (the default). */
  collapsed: Record<string, boolean>;
  toggle: (key: string) => void;
}

/**
 * Which project sections the user folded away, remembered across launches.
 * Persisted as a plain key array — sections are named by workpath, so a project
 * that disappears simply stops matching and costs one dead string.
 */
export function useCollapsedWorkpaths(): CollapsedWorkpaths {
  const storageKey = connectionStorageKey(COLLAPSED_STORAGE_KEY);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (!active) return;
        if (raw) {
          try {
            const parsed: unknown = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const next: Record<string, boolean> = {};
              for (const key of parsed) if (typeof key === 'string') next[key] = true;
              setCollapsed(next);
            }
          } catch {
            // Corrupt entry — start from "everything expanded".
          }
        }
        setLoaded(true);
      })
      .catch(() => {
        // Storage unavailable (private-mode web): keep the in-memory state.
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [storageKey]);

  // Only write after the initial read, or the empty first render would wipe it.
  useEffect(() => {
    if (!loaded) return;
    const keys = Object.keys(collapsed).filter((key) => collapsed[key]);
    void AsyncStorage.setItem(storageKey, JSON.stringify(keys)).catch(() => {
      // Best effort; the fold state still holds for this session.
    });
  }, [collapsed, loaded, storageKey]);

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return { collapsed, toggle };
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
  // Desktop-side agent/knowledge edits rebind the session; re-project the row.
  useWsTopic('agentSession.agentChanged', (payload) => {
    if (agentSessionIdOf(payload) === conversationId) void swr.mutate();
  });
  useWsTopic('agentSession.knowledgeChanged', (payload) => {
    if (agentSessionIdOf(payload) === conversationId) void swr.mutate();
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
  /**
   * Appends an optimistic bubble; throws (and rolls it back) on failure.
   * `files` are absolute desktop paths from `POST /api/fs/upload`.
   */
  send: (text: string, files?: readonly string[]) => Promise<void>;
  /**
   * Re-ask the last user message as a fresh turn — the recovery path for a
   * failed or truncated turn (the retired `continue-truncated` endpoint has no
   * canonical successor; the desktop itself puts the prompt back in the
   * composer for a normal resend).
   */
  retryLast: () => Promise<void>;
  stop: () => Promise<void>;
}

let localSeq = 0;

export function useChatSession(
  conversationId: string | undefined,
  conversation: Conversation | undefined,
  refreshConversation?: () => Promise<Conversation | undefined>,
): ChatSessionState {
  const key = conversationId ? messagesPath(conversationId, '') : null;
  const { data, error, isLoading, mutate } = useSWR<Paginated<StoredMessage>>(key);

  const [older, setOlder] = useState<OlderState>({ rows: [], hasMore: null });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [live, setLive] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [runtimeCanSend, setRuntimeCanSend] = useState<boolean | null>(null);
  const failedSend = useRef<{ signature: string; idempotencyKey: string } | null>(
    null,
  );
  /** Once a turn.completed lands, WS is authoritative over the durable row. */
  const sawCompletion = useRef(false);
  const activeTurnId = useRef<string | null>(null);
  const completedTurnIds = useRef<Set<string>>(new Set());
  const awaitingTurn = useRef(false);
  const pendingAcceptance = useRef<Promise<SendMessageResult> | null>(null);
  const runtimeGeneration = useRef(0);

  // Switching conversations resets every per-chat projection.
  useEffect(() => {
    setOlder({ rows: [], hasMore: null });
    setLive([]);
    setStreaming(false);
    setRuntimeCanSend(null);
    failedSend.current = null;
    sawCompletion.current = false;
    activeTurnId.current = null;
    completedTurnIds.current.clear();
    awaitingTurn.current = false;
    pendingAcceptance.current = null;
    runtimeGeneration.current += 1;
  }, [conversationId]);

  // A runtime snapshot may reopen only when it names a new exact turn. This
  // rejects an old in-flight GET that lands after turn.completed while still
  // allowing a later turn started on another client to hydrate correctly.
  useEffect(() => {
    const runtime = conversation?.runtime;
    if (!runtime) return;
    if (runtime.is_processing !== true) {
      if (activeTurnId.current || awaitingTurn.current) return;
      sawCompletion.current = true;
      setStreaming(false);
      if (typeof runtime.can_send_message === 'boolean') {
        setRuntimeCanSend(runtime.can_send_message);
      }
      return;
    }
    const runtimeTurnId = runtime.active_turn_id?.trim() || undefined;
    if (runtimeTurnId && completedTurnIds.current.has(runtimeTurnId)) {
      awaitingTurn.current = false;
      activeTurnId.current = null;
      sawCompletion.current = true;
      setStreaming(false);
      setRuntimeCanSend(true);
      return;
    }
    if (
      sawCompletion.current &&
      (!runtimeTurnId || completedTurnIds.current.has(runtimeTurnId))
    ) {
      return;
    }
    if (runtimeTurnId) {
      activeTurnId.current = runtimeTurnId;
      completedTurnIds.current.delete(runtimeTurnId);
    }
    awaitingTurn.current = false;
    sawCompletion.current = false;
    setStreaming(true);
    if (typeof runtime.can_send_message === 'boolean') {
      setRuntimeCanSend(runtime.can_send_message);
    }
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
  const reconcileRuntime = useCallback(async () => {
    if (!refreshConversation) return;
    const generation = runtimeGeneration.current;
    let fresh: Conversation | undefined;
    try {
      fresh = await refreshConversation();
    } catch {
      return;
    }
    if (generation !== runtimeGeneration.current) return;
    if (!fresh?.runtime) return;

    const runtime = fresh.runtime;
    awaitingTurn.current = false;
    if (runtime?.is_processing === true) {
      const runtimeTurnId = runtime.active_turn_id?.trim() || undefined;
      if (runtimeTurnId && completedTurnIds.current.has(runtimeTurnId)) {
        activeTurnId.current = null;
        sawCompletion.current = true;
        setStreaming(false);
        setRuntimeCanSend(true);
        return;
      }
      activeTurnId.current = runtimeTurnId ?? null;
      sawCompletion.current = false;
      setStreaming(true);
      setRuntimeCanSend(runtime.can_send_message ?? false);
      return;
    }

    activeTurnId.current = null;
    sawCompletion.current = true;
    setStreaming(false);
    setRuntimeCanSend(runtime?.can_send_message ?? true);
  }, [refreshConversation]);
  const reconcileRuntimeSoon = useDebouncedCallback(() => {
    void reconcileRuntime();
  }, 400);

  useWsTopic('message.stream', (payload) => {
    if (!conversationId || conversationIdOf(payload) !== conversationId) return;
    const frame = payload as StreamFrame;
    setLive((prev) => reduceStreamFrame(prev, frame));
    if (
      shouldOpenStreamingForFrame(frame, {
        activeTurnId: activeTurnId.current,
        completedTurnIds: completedTurnIds.current,
        turnClosed: sawCompletion.current && !awaitingTurn.current,
      })
    ) {
      setStreaming(true);
    }
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
    const runtime =
      isRecord(payload) && isRecord(payload.runtime)
        ? payload.runtime
        : undefined;
    const turnId = turnIdOf(payload);
    const runtimeTurnId =
      typeof runtime?.active_turn_id === 'string' &&
      runtime.active_turn_id.trim()
        ? runtime.active_turn_id
        : undefined;
    const processing =
      (typeof runtime?.is_processing === 'boolean'
        ? runtime.is_processing
        : undefined) ??
      (isRecord(payload) && typeof payload.is_processing === 'boolean'
        ? payload.is_processing
        : true);
    const nextTurnId = runtimeTurnId ?? turnId;
    if (
      !processing ||
      (turnId && runtimeTurnId && turnId !== runtimeTurnId) ||
      (activeTurnId.current &&
        nextTurnId &&
        activeTurnId.current !== nextTurnId &&
        !sawCompletion.current)
    ) {
      return;
    }
    if (nextTurnId) {
      activeTurnId.current = nextTurnId;
      completedTurnIds.current.delete(nextTurnId);
    }
    runtimeGeneration.current += 1;
    awaitingTurn.current = false;
    sawCompletion.current = false;
    setStreaming(true);
    const canSend =
      (isRecord(payload) && typeof payload.can_send_message === 'boolean'
        ? payload.can_send_message
        : undefined) ??
      (typeof runtime?.can_send_message === 'boolean'
        ? runtime.can_send_message
        : undefined) ??
      false;
    setRuntimeCanSend(canSend);
  });

  useWsTopic('turn.completed', (payload) => {
    if (!conversationId || conversationIdOf(payload) !== conversationId) return;
    const turnId = turnIdOf(payload);
    const currentTurnId = activeTurnId.current;
    rememberCompletedTurn(
      completedTurnIds.current,
      turnId ?? currentTurnId ?? undefined,
    );
    if (currentTurnId && turnId && currentTurnId !== turnId) {
      reconcileSoon();
      return;
    }
    if (awaitingTurn.current && !currentTurnId) {
      reconcileRuntimeSoon();
      return;
    }
    runtimeGeneration.current += 1;
    activeTurnId.current = null;
    awaitingTurn.current = false;
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

  // A paused turn is still open (owner authorization pending) — keep the
  // composer locked but stop the busy affordance; `turn.started` on resume or
  // `turn.completed` on cancel close it out.
  useWsTopic('turn.paused', (payload) => {
    if (!conversationId || conversationIdOf(payload) !== conversationId) return;
    const runtime = isRecord(payload) && isRecord(payload.runtime) ? payload.runtime : undefined;
    awaitingTurn.current = false;
    setStreaming(true);
    const canSend =
      (isRecord(payload) && typeof payload.can_send_message === 'boolean'
        ? payload.can_send_message
        : undefined) ??
      (typeof runtime?.can_send_message === 'boolean' ? runtime.can_send_message : undefined) ??
      false;
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
    setRuntimeCanSend(false);
    sawCompletion.current = true;
    activeTurnId.current = null;
    completedTurnIds.current.clear();
    awaitingTurn.current = false;
    runtimeGeneration.current += 1;
    reconcileRuntimeSoon();
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
    async (text: string, files: readonly string[] = []) => {
      const trimmed = text.trim();
      // An attachment-only turn is legitimate ("look at this"), but an empty
      // body with nothing attached is not.
      if (!conversationId || (!trimmed && files.length === 0)) return;
      // The marker is what makes the attachment survive a reload — see
      // features/sessions/attachments.ts.
      const content = buildMessageContent(trimmed, files);
      const signature = JSON.stringify([content, [...files]]);
      const idempotencyKey =
        failedSend.current?.signature === signature
          ? failedSend.current.idempotencyKey
          : newIdempotencyKey();
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
      runtimeGeneration.current += 1;
      awaitingTurn.current = true;
      sawCompletion.current = false;
      setStreaming(true);
      let completedReceipt = false;
      let acceptance: Promise<SendMessageResult> | undefined;
      try {
        acceptance = postMessage(
          conversationId,
          content,
          files,
          idempotencyKey,
        );
        pendingAcceptance.current = acceptance;
        const result = await acceptance;
        failedSend.current = null;
        setLive((prev) =>
          prev.map((m) =>
            m.key === localKey
              ? { ...m, pending: false, msgId: m.msgId ?? result?.msg_id, key: localKey }
              : m,
          ),
        );
        if (result.completed === true) {
          // A completed replay is a durable terminal receipt, not a new turn.
          // Do not leave the phone in a local streaming state after it has
          // already been settled by the server.
          setStreaming(false);
          setRuntimeCanSend(true);
          awaitingTurn.current = false;
          sawCompletion.current = true;
          activeTurnId.current = null;
          void reconcile();
          if (result.result_ok === false) {
            completedReceipt = true;
            throw new ApiError(
              result.result_error ||
                result.result_error_code ||
                'The desktop could not complete this message',
              409,
              result.result_error_code ?? undefined,
            );
          }
        } else if (result.replayed === true) {
          // The earlier delivery may still be running. Close the local
          // lifecycle first; only an authoritative conversation runtime
          // snapshot may reopen it.
          setStreaming(false);
          setRuntimeCanSend(false);
          awaitingTurn.current = false;
          sawCompletion.current = true;
          activeTurnId.current = null;
          completedTurnIds.current.clear();
          reconcileRuntimeSoon();
          // Reconcile the transcript as well; the accepted user row may already
          // have been committed before this HTTP response was observed.
          reconcileSoon();
        } else {
          if (!sawCompletion.current && !activeTurnId.current && !completedTurnIds.current.has(result.msg_id)) {
            activeTurnId.current = result.msg_id;
          }
          // A fresh acceptance may race or lose its turn.started event. Verify
          // the current runtime so the composer cannot remain optimistic
          // forever after a fast completion or a delivery gap.
          reconcileRuntimeSoon();
        }
      } catch (err) {
        failedSend.current = completedReceipt
          ? null
          : { signature, idempotencyKey };
        setLive((prev) => prev.filter((m) => m.key !== localKey));
        awaitingTurn.current = false;
        setStreaming(false);
        throw err;
      } finally {
        if (pendingAcceptance.current === acceptance) pendingAcceptance.current = null;
      }
    },
    [conversationId, reconcile, reconcileRuntimeSoon, reconcileSoon],
  );

  const retryLast = useCallback(async () => {
    const lastUser = [...messages]
      .reverse()
      .find(
        (m) => m.type === 'text' && m.position === 'right' && m.pending !== true,
      );
    // Attached paths were single-use temp files; the marker is stripped and
    // only the text goes back out.
    const { text } = parseMessageContent(textBody(lastUser?.content));
    if (!text.trim()) return;
    await send(text);
  }, [messages, send]);

  const stop = useCallback(async () => {
    if (!conversationId) return;
    const epoch = connectionStore.epoch();
    const cancelled = await cancelObservedTurn(
      activeTurnId.current ?? (sawCompletion.current ? undefined : conversation?.runtime?.active_turn_id),
      pendingAcceptance.current,
      (turnId) => cancelTurn(conversationId, turnId, epoch),
    );
    reconcileRuntimeSoon();
    if (!cancelled) throw new Error(i18n.t('composer.turnIdentityUnavailable', { ns: 'sessions' }));
  }, [conversationId, conversation?.runtime?.active_turn_id, reconcileRuntimeSoon]);

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
    retryLast,
    stop,
  };
}

export { CONVERSATION_PAGE_SIZE };
