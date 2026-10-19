/** Message history and streaming hooks. Session entities and list lifecycle
 * are owned by SessionDataProvider; chat history remains a separate query. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { connectionStorageKey, connectionStore } from '@/api/connection';
import useSWR from 'swr';

import { ApiError } from '@/api/types';
import { useWsTopic } from '@/hooks/use-ws';
import i18n from '@/i18n';

import {
  cancelTurn,
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
import { useSessionData } from './provider';
import { reconcileRuntimeSnapshot } from './runtime-recovery';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function conversationIdOf(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  const id = data.conversation_id;
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

export { useSessionDetail as useConversation } from './provider';

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
  const { epoch, recoveryVersion } = useSessionData();
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
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; runtimeGeneration.current += 1; };
  }, []);

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
    void reconcile().catch(() => undefined); // SWR retains the read error for retry.
  }, 400);
  const reconcileRuntime = useCallback(async () => {
    if (!refreshConversation) return;
    await reconcileRuntimeSnapshot({
      read: refreshConversation,
      acceptance: pendingAcceptance.current,
      generation: () => runtimeGeneration.current,
      isCurrent: () => mounted.current && connectionStore.epoch() === epoch,
      completedTurnIds: completedTurnIds.current,
      apply: runtime => {
        awaitingTurn.current = false;
        activeTurnId.current = runtime.activeTurnId;
        sawCompletion.current = runtime.sawCompletion;
        setStreaming(runtime.streaming);
        setRuntimeCanSend(runtime.canSend);
      },
    });
  }, [refreshConversation, epoch]);
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
    if (!processing || (turnId && runtimeTurnId && turnId !== runtimeTurnId)) return;
    // Even when an earlier delivery gap left another active ID locally, this
    // exact start fences every older HTTP snapshot. The fresh entity read can
    // reconcile which turn currently owns the runtime.
    runtimeGeneration.current += 1;
    if (activeTurnId.current &&
        nextTurnId &&
        activeTurnId.current !== nextTurnId &&
        !sawCompletion.current) {
      return;
    }
    if (nextTurnId) {
      activeTurnId.current = nextTurnId;
      completedTurnIds.current.delete(nextTurnId);
    }
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
    runtimeGeneration.current += 1;
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

  const runtimeRefreshRef = useRef(reconcileRuntime);
  runtimeRefreshRef.current = reconcileRuntime;
  const historyRefreshRef = useRef(mutate);
  historyRefreshRef.current = mutate;
  const recoveredVersion = useRef(recoveryVersion);
  // The provider owns every delivery-gap signal, including short native
  // suspensions whose socket still reports OPEN. Keep the current turn lock
  // until a fresh snapshot proves its state; newer lifecycle frames fence it.
  useEffect(() => {
    if (recoveredVersion.current === recoveryVersion) return;
    recoveredVersion.current = recoveryVersion;
    if (!conversationId) return;
    setLive([]);
    runtimeGeneration.current += 1;
    void runtimeRefreshRef.current();
    void historyRefreshRef.current().catch(() => undefined);
  }, [conversationId, recoveryVersion]);

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
          void reconcile().catch(() => undefined);
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
    retry: () => { void mutate().catch(() => undefined); },
    loadOlder,
    send,
    retryLast,
    stop,
  };
}
