/**
 * `src/features/sessions/stream.ts` — the `message.stream` delta reducer.
 *
 * The invariants worth locking down: identity is `msg_id` + render type, text
 * appends unless told to replace, thinking back-patches on `status: 'done'`,
 * tool frames merge by `call_id` with error as an absorbing state, and every
 * frame the phone cannot render leaves the array *identical* (same instance) so
 * React never re-renders for a swallowed frame.
 */
import { describe, expect, it } from 'bun:test';

import type { StoredMessage, ToolCallContent } from '@/features/sessions/api';
import {
  type ChatMessage,
  type StreamFrame,
  compareMessages,
  dedupeKey,
  fromStoredMessage,
  reduceStreamFrame,
  textBody,
  thinkingBody,
  tipsBody,
  toolEntries,
} from '@/features/sessions/stream';

/** Fold a whole frame sequence, like the socket handler does. */
function fold(frames: StreamFrame[], initial: ChatMessage[] = []): ChatMessage[] {
  return frames.reduce(reduceStreamFrame, initial);
}

function text(msgId: string, content: string, extra: Partial<StreamFrame> = {}): StreamFrame {
  return { msg_id: msgId, type: 'content', data: { content }, created_at: 1000, ...extra };
}

describe('reduceStreamFrame — text', () => {
  it('appends deltas of the same msg_id into one bubble', () => {
    const live = fold([text('m1', 'He'), text('m1', 'llo'), text('m1', ' world')]);
    expect(live).toHaveLength(1);
    expect(textBody(live[0].content)).toBe('Hello world');
    expect(live[0].key).toBe(dedupeKey('m1', 'text'));
    expect(live[0].streaming).toBe(true);
  });

  it('keeps the first frame createdAt while merging', () => {
    const live = fold([text('m1', 'a', { created_at: 500 }), text('m1', 'b', { created_at: 900 })]);
    expect(live[0].createdAt).toBe(500);
  });

  it('honours a frame-level replace flag', () => {
    const live = fold([text('m1', 'draft'), text('m1', 'final', { replace: true })]);
    expect(textBody(live[0].content)).toBe('final');
  });

  it('honours replace nested in the payload', () => {
    const live = fold([
      text('m1', 'draft'),
      { msg_id: 'm1', type: 'content', data: { content: 'final', replace: true } },
    ]);
    expect(textBody(live[0].content)).toBe('final');
  });

  it('starts a new bubble for a different msg_id', () => {
    const live = fold([text('m1', 'one'), text('m2', 'two')]);
    expect(live).toHaveLength(2);
    expect(live.map((message) => textBody(message.content))).toEqual(['one', 'two']);
  });

  it('does not merge across render types even with the same msg_id', () => {
    const live = fold([
      text('m1', 'answer'),
      { msg_id: 'm1', type: 'thinking', data: { content: 'hmm' } },
    ]);
    expect(live).toHaveLength(2);
    expect(live.map((message) => message.type)).toEqual(['text', 'thinking']);
  });

  it('renders user_content on the right', () => {
    const live = fold([{ msg_id: 'u1', type: 'user_content', data: { content: 'hi' } }]);
    expect(live[0].position).toBe('right');
    expect(live[0].type).toBe('text');
  });

  it('drops an empty first delta without touching the array', () => {
    const live: ChatMessage[] = [];
    expect(reduceStreamFrame(live, text('m1', ''))).toBe(live);
  });

  it('tolerates a missing msg_id with a synthetic key', () => {
    const live = fold([{ type: 'content', data: { content: 'anon' }, created_at: 42 }]);
    expect(live).toHaveLength(1);
    expect(live[0].key).toBe('stream-42-0');
    // Without a msg_id nothing is mergeable, so a second frame is its own bubble.
    const more = reduceStreamFrame(live, { type: 'content', data: { content: 'again' }, created_at: 42 });
    expect(more).toHaveLength(2);
  });

  it('reads text out of a bare string, `message` or `error` payload', () => {
    expect(textBody(fold([{ msg_id: 'm', type: 'content', data: 'plain' }])[0].content)).toBe('plain');
    expect(
      textBody(fold([{ msg_id: 'm', type: 'content', data: { message: 'from message' } }])[0].content),
    ).toBe('from message');
    expect(
      textBody(fold([{ msg_id: 'm', type: 'content', data: { error: 'from error' } }])[0].content),
    ).toBe('from error');
  });
});

describe('reduceStreamFrame — thinking', () => {
  it('accumulates and then closes on status done', () => {
    const live = fold([
      { msg_id: 'm1', type: 'thinking', data: { content: 'step 1 ' } },
      { msg_id: 'm1', type: 'thinking', data: { content: 'step 2' } },
      { msg_id: 'm1', type: 'thinking', data: { status: 'done', duration: 12 } },
    ]);
    expect(live).toHaveLength(1);
    const body = thinkingBody(live[0].content);
    expect(body.content).toBe('step 1 step 2');
    expect(body.status).toBe('done');
    expect(body.duration).toBe(12);
    expect(live[0].streaming).toBe(false);
  });

  it('keeps the subject once the server has sent one', () => {
    const live = fold([
      { msg_id: 'm1', type: 'thinking', data: { content: 'a', subject: 'Plan' } },
      { msg_id: 'm1', type: 'thinking', data: { content: 'b' } },
    ]);
    expect(thinkingBody(live[0].content).subject).toBe('Plan');
  });

  it('opens a closed bubble for a one-shot done frame', () => {
    const live = fold([{ msg_id: 'm1', type: 'thinking', data: { content: 'all of it', status: 'done' } }]);
    expect(live[0].streaming).toBe(false);
    expect(thinkingBody(live[0].content).content).toBe('all of it');
  });

  it('survives a non-object payload', () => {
    const live = fold([{ msg_id: 'm1', type: 'thinking', data: 'ignored' }]);
    expect(live).toHaveLength(1);
    expect(thinkingBody(live[0].content).content).toBe('');
  });
});

describe('reduceStreamFrame — tips and errors', () => {
  it('turns an error frame into a centered tip', () => {
    const live = fold([{ msg_id: 'm1', type: 'error', data: { content: 'boom' } }]);
    expect(live[0].type).toBe('tips');
    expect(live[0].position).toBe('center');
    expect(tipsBody(live[0].content)).toEqual({ content: 'boom', type: 'error' });
  });

  it('defaults a tip without a kind to warning', () => {
    const live = fold([{ msg_id: 'm1', type: 'tips', data: { content: 'heads up' } }]);
    expect(tipsBody(live[0].content).type).toBe('warning');
  });

  it('never merges tips — each one is its own bubble', () => {
    const live = fold([
      { msg_id: 'm1', type: 'tips', data: { content: 'one' } },
      { msg_id: 'm1', type: 'tips', data: { content: 'two' } },
    ]);
    expect(live).toHaveLength(2);
    expect(live[0].streaming).toBe(false);
  });

  it('drops an empty tip', () => {
    const live: ChatMessage[] = [];
    expect(reduceStreamFrame(live, { msg_id: 'm1', type: 'tips', data: {} })).toBe(live);
  });
});

describe('reduceStreamFrame — tool frames', () => {
  it('merges a tool_call by msg_id and keeps an error status', () => {
    const live = fold([
      { msg_id: 'm1', type: 'tool_call', data: { call_id: 'c1', name: 'read', status: 'running' } },
      { msg_id: 'm1', type: 'tool_call', data: { call_id: 'c1', status: 'error', error: 'nope' } },
      { msg_id: 'm1', type: 'tool_call', data: { call_id: 'c1', status: 'done' } },
    ]);
    expect(live).toHaveLength(1);
    const entry = toolEntries(live[0])[0];
    expect(entry.status).toBe('error');
    expect(entry.error).toBe('nope');
    expect(entry.name).toBe('read');
  });

  it('merges a tool_group by call_id and appends unknown calls', () => {
    const live = fold([
      { msg_id: 'm1', type: 'tool_group', data: [{ call_id: 'c1', name: 'read', status: 'running' }] },
      {
        msg_id: 'm1',
        type: 'tool_group',
        data: [
          { call_id: 'c1', status: 'done' },
          { call_id: 'c2', name: 'write', status: 'running' },
        ],
      },
    ]);
    expect(live).toHaveLength(1);
    const entries = toolEntries(live[0]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ call_id: 'c1', name: 'read', status: 'done' } as ToolCallContent);
    expect(entries[1].name).toBe('write');
  });

  it('falls back to the tool name when a group entry has no call_id', () => {
    const live = fold([
      { msg_id: 'm1', type: 'tool_group', data: [{ name: 'read', status: 'running' }] },
      { msg_id: 'm1', type: 'tool_group', data: [{ name: 'read', status: 'done' }] },
    ]);
    expect(toolEntries(live[0])).toHaveLength(1);
    expect(toolEntries(live[0])[0].status).toBe('done');
  });

  it('treats a non-array tool_group payload as empty', () => {
    const live = fold([{ msg_id: 'm1', type: 'tool_group', data: { call_id: 'c1' } }]);
    expect(toolEntries(live[0])).toEqual([]);
  });
});

describe('reduceStreamFrame — finish and swallowed frames', () => {
  it('closes every streaming bubble', () => {
    const live = fold([text('m1', 'hi'), { msg_id: 'm1', type: 'finish' }]);
    expect(live[0].streaming).toBe(false);
    expect(live[0].status).toBe('finish');
  });

  it('leaves already-finished bubbles alone', () => {
    const live = fold([
      { msg_id: 'm1', type: 'tips', data: { content: 'note' } },
      { msg_id: 'm1', type: 'finish' },
    ]);
    expect(live[0].status).toBeUndefined();
  });

  it('does not allocate for a finish on an empty transcript', () => {
    const live: ChatMessage[] = [];
    expect(reduceStreamFrame(live, { type: 'finish' })).toBe(live);
  });

  it('swallows hidden frames', () => {
    const live = fold([text('m1', 'visible')]);
    expect(reduceStreamFrame(live, text('m1', ' hidden', { hidden: true }))).toBe(live);
  });

  it('swallows every unknown / desktop-only frame type', () => {
    const live = fold([text('m1', 'x')]);
    for (const type of ['start', 'plan', 'permission', 'acp_update', 'diagnostics', '', 'nope']) {
      expect(reduceStreamFrame(live, { msg_id: 'm1', type, data: { content: 'ignored' } })).toBe(live);
    }
    expect(reduceStreamFrame(live, { msg_id: 'm1' })).toBe(live);
  });
});

describe('fromStoredMessage', () => {
  function row(overrides: Partial<StoredMessage>): StoredMessage {
    return {
      message_id: 'r1',
      conversation_id: 'c1',
      type: 'text',
      content: { content: 'stored' },
      created_at: 5,
      ...overrides,
    };
  }

  it('maps a persisted text row onto a bubble keyed by its durable id', () => {
    const message = fromStoredMessage(row({ msg_id: 'm1', status: 'finish' }));
    expect(message?.key).toBe('r1');
    expect(message?.messageId).toBe('r1');
    expect(message?.msgId).toBe('m1');
    expect(message?.position).toBe('left');
    expect(message?.status).toBe('finish');
  });

  it('drops hidden and non-renderable rows', () => {
    expect(fromStoredMessage(row({ hidden: true }))).toBeNull();
    expect(fromStoredMessage(row({ type: 'plan' }))).toBeNull();
    expect(fromStoredMessage(row({ type: 'permission' }))).toBeNull();
  });

  it('centers tips that arrive without a position', () => {
    expect(fromStoredMessage(row({ type: 'tips' }))?.position).toBe('center');
  });

  it('lifts turn_id out of the content when present', () => {
    const message = fromStoredMessage(row({ content: { content: 'x', turn_id: 't1' } }));
    expect(message?.turnId).toBe('t1');
    expect(fromStoredMessage(row({ content: 'plain string' }))?.turnId).toBeUndefined();
  });
});

describe('compareMessages', () => {
  const at = (key: string, createdAt: number, messageId?: string): ChatMessage => ({
    key,
    messageId,
    type: 'text',
    content: {},
    position: 'left',
    createdAt,
  });

  it('sorts ascending by createdAt', () => {
    expect(compareMessages(at('a', 1), at('b', 2))).toBeLessThan(0);
    expect(compareMessages(at('a', 3), at('b', 2))).toBeGreaterThan(0);
  });

  it('breaks ties by durable id, falling back to the key', () => {
    expect(compareMessages(at('x', 1, 'a'), at('y', 1, 'b'))).toBeLessThan(0);
    expect(compareMessages(at('a', 1), at('b', 1))).toBeLessThan(0);
  });
});
