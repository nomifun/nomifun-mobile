/**
 * Chat transcript model + the `message.stream` delta reducer.
 *
 * Mirrors the desktop merge semantics (docs/research/feature-sessions.md §4):
 * identity is `msg_id` + render type, text appends unless `replace`, thinking
 * back-patches on `status: 'done'`, tool frames merge by `call_id` with error
 * as an absorbing state. Everything the mobile client cannot render is
 * swallowed silently rather than turned into a bubble.
 */
import type {
  MessagePosition,
  MessageStatus,
  StoredMessage,
  ThinkingContent,
  ToolCallContent,
} from './api';

export type ChatMessageType = 'text' | 'thinking' | 'tips' | 'tool_call' | 'tool_group';

export interface ChatMessage {
  /** Stable React key: durable id when persisted, `msg_id|type` while streaming. */
  key: string;
  msgId?: string;
  messageId?: string;
  turnId?: string;
  type: ChatMessageType;
  content: unknown;
  position: MessagePosition;
  status?: MessageStatus;
  createdAt: number;
  /** Optimistic local bubble waiting for its server receipt. */
  pending?: boolean;
  /** Still accumulating deltas. */
  streaming?: boolean;
}

/** Raw `message.stream` payload (outer envelope already unwrapped). */
export interface StreamFrame {
  conversation_id?: string;
  msg_id?: string;
  turn_id?: string;
  type?: string;
  data?: unknown;
  hidden?: boolean;
  status?: string;
  created_at?: number;
  replace?: boolean;
  stream_complete?: boolean;
}

const RENDERABLE = new Set<ChatMessageType>([
  'text',
  'thinking',
  'tips',
  'tool_call',
  'tool_group',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** Best-effort text extraction across `{content}` / `{message}` / `{error}` bodies. */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return '';
  return (
    asString(value.content) ||
    asString(value.message) ||
    asString(value.text) ||
    asString(value.error) ||
    ''
  );
}

function defaultPosition(type: ChatMessageType): MessagePosition {
  return type === 'tips' ? 'center' : 'left';
}

// ── Persisted rows ─────────────────────────────────────────────────

/** Map a history row onto a bubble; `null` = not renderable on mobile. */
export function fromStoredMessage(row: StoredMessage): ChatMessage | null {
  if (row.hidden === true) return null;
  const type = row.type as ChatMessageType;
  if (!RENDERABLE.has(type)) return null;
  const turnId = isRecord(row.content) ? asString(row.content.turn_id) : '';
  return {
    key: row.message_id,
    msgId: row.msg_id ?? undefined,
    messageId: row.message_id,
    turnId: turnId || undefined,
    type,
    content: row.content,
    position: row.position ?? defaultPosition(type),
    status: row.status ?? undefined,
    createdAt: row.created_at,
  };
}

/** Ascending transcript order: `created_at`, tie-broken by durable id. */
export function compareMessages(a: ChatMessage, b: ChatMessage): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return (a.messageId ?? a.key).localeCompare(b.messageId ?? b.key);
}

export function dedupeKey(msgId: string, type: ChatMessageType): string {
  return `${msgId}|${type}`;
}

// ── Stream frames ──────────────────────────────────────────────────

interface Mapped {
  type: ChatMessageType;
  position: MessagePosition;
}

/**
 * Wire `type` → bubble. `undefined` for the frames the desktop also swallows
 * (`start`, `finish`, `plan`, `permission`, ACP variants, diagnostics…).
 */
function mapWireType(wire: string): Mapped | undefined {
  switch (wire) {
    case 'content':
    case 'text':
      return { type: 'text', position: 'left' };
    case 'user_content':
      return { type: 'text', position: 'right' };
    case 'thinking':
      return { type: 'thinking', position: 'left' };
    case 'tips':
      return { type: 'tips', position: 'center' };
    case 'error':
      return { type: 'tips', position: 'center' };
    case 'tool_call':
      return { type: 'tool_call', position: 'left' };
    case 'tool_group':
      return { type: 'tool_group', position: 'left' };
    default:
      return undefined;
  }
}

const ERROR_STATUSES = new Set(['error', 'Error', 'failed']);

function mergeToolEntry(prev: ToolCallContent, next: ToolCallContent): ToolCallContent {
  const merged: ToolCallContent = { ...prev, ...next };
  // Error is absorbing: a later non-error frame must not clear the failure.
  if (prev.status && ERROR_STATUSES.has(prev.status)) merged.status = prev.status;
  if (prev.error !== undefined && next.error === undefined) merged.error = prev.error;
  return merged;
}

function mergeToolGroup(prev: unknown, next: unknown): ToolCallContent[] {
  const prevList: ToolCallContent[] = Array.isArray(prev) ? (prev as ToolCallContent[]) : [];
  const nextList: ToolCallContent[] = Array.isArray(next) ? (next as ToolCallContent[]) : [];
  const out = [...prevList];
  for (const entry of nextList) {
    const at = out.findIndex(
      (candidate) =>
        (entry.call_id && candidate.call_id === entry.call_id) ||
        (!entry.call_id && candidate.name === entry.name),
    );
    if (at >= 0) out[at] = mergeToolEntry(out[at], entry);
    else out.push(entry);
  }
  return out;
}

/**
 * Fold one `message.stream` frame into the live (not-yet-persisted) tail.
 * Returns the same array instance when the frame carries nothing renderable.
 */
export function reduceStreamFrame(live: ChatMessage[], frame: StreamFrame): ChatMessage[] {
  if (frame.hidden === true) return live;
  const wire = frame.type ?? '';

  if (wire === 'finish') {
    if (live.length === 0) return live;
    return live.map((message) =>
      message.streaming ? { ...message, streaming: false, status: 'finish' } : message,
    );
  }

  const mapped = mapWireType(wire);
  if (!mapped) return live;

  const msgId = frame.msg_id;
  const createdAt = frame.created_at ?? Date.now();
  const tail = live.length > 0 ? live[live.length - 1] : undefined;
  const mergeable = !!tail && !!msgId && tail.msgId === msgId && tail.type === mapped.type;

  const build = (content: unknown, streaming: boolean): ChatMessage => ({
    key: msgId ? dedupeKey(msgId, mapped.type) : `stream-${createdAt}-${live.length}`,
    msgId,
    turnId: frame.turn_id,
    type: mapped.type,
    content,
    position: mapped.position,
    status: frame.status as MessageStatus | undefined,
    createdAt: mergeable && tail ? tail.createdAt : createdAt,
    streaming,
  });

  const replaceTail = (next: ChatMessage): ChatMessage[] => [...live.slice(0, -1), next];

  switch (mapped.type) {
    case 'text': {
      const delta = textOf(frame.data);
      const replace = frame.replace === true || (isRecord(frame.data) && frame.data.replace === true);
      if (mergeable && tail) {
        const prev = isRecord(tail.content) ? asString(tail.content.content) : '';
        const next = build({ content: replace ? delta : prev + delta }, true);
        return replaceTail({ ...next, createdAt: tail.createdAt, key: tail.key });
      }
      if (!delta) return live;
      return [...live, build({ content: delta }, true)];
    }
    case 'thinking': {
      const body = isRecord(frame.data) ? (frame.data as ThinkingContent) : {};
      const delta = asString(body.content);
      const done = body.status === 'done';
      if (mergeable && tail) {
        const prev = isRecord(tail.content) ? (tail.content as ThinkingContent) : {};
        const content: ThinkingContent = {
          ...prev,
          content: done && !delta ? (prev.content ?? '') : (prev.content ?? '') + delta,
          subject: body.subject ?? prev.subject,
          duration: body.duration ?? prev.duration,
          status: done ? 'done' : 'thinking',
        };
        return replaceTail({ ...build(content, !done), createdAt: tail.createdAt, key: tail.key });
      }
      return [
        ...live,
        build({ ...body, content: delta, status: done ? 'done' : 'thinking' }, !done),
      ];
    }
    case 'tips': {
      const body = isRecord(frame.data) ? frame.data : {};
      const content = {
        content: textOf(frame.data),
        type: wire === 'error' ? 'error' : (asString(body.type) || 'warning'),
      };
      if (!content.content) return live;
      return [...live, build(content, false)];
    }
    case 'tool_call': {
      const body = isRecord(frame.data) ? (frame.data as ToolCallContent) : {};
      if (mergeable && tail) {
        const prev = isRecord(tail.content) ? (tail.content as ToolCallContent) : {};
        const content = mergeToolEntry(prev, body);
        return replaceTail({ ...build(content, false), createdAt: tail.createdAt, key: tail.key });
      }
      return [...live, build(body, false)];
    }
    case 'tool_group': {
      if (mergeable && tail) {
        const content = mergeToolGroup(tail.content, frame.data);
        return replaceTail({ ...build(content, false), createdAt: tail.createdAt, key: tail.key });
      }
      return [...live, build(mergeToolGroup([], frame.data), false)];
    }
    default:
      return live;
  }
}

// ── Presentation helpers ───────────────────────────────────────────

export function textBody(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!isRecord(content)) return '';
  return asString(content.content);
}

export function thinkingBody(content: unknown): ThinkingContent {
  return isRecord(content) ? (content as ThinkingContent) : {};
}

export function tipsBody(content: unknown): { content: string; type: string } {
  const body = isRecord(content) ? content : {};
  return { content: textOf(content), type: asString(body.type) || 'warning' };
}

export function toolEntries(message: ChatMessage): ToolCallContent[] {
  if (message.type === 'tool_group') {
    return Array.isArray(message.content) ? (message.content as ToolCallContent[]) : [];
  }
  return isRecord(message.content) ? [message.content as ToolCallContent] : [];
}
