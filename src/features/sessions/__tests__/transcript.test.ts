import { describe, expect, test } from 'bun:test';
import type { ChatMessage } from '../stream';
import { projectTranscript } from '../transcript';

const message = (key: string, type: ChatMessage['type'], content: unknown, patch: Partial<ChatMessage> = {}): ChatMessage => ({
  key, type, content, position: 'left', createdAt: 1, ...patch,
});
const thinking = (key: string, patch: Partial<ChatMessage> = {}) => message(key, 'thinking', { content: key, status: 'done' }, patch);
const tool = (key: string, patch: Partial<ChatMessage> = {}) => message(key, 'tool_call', { name: key, status: 'success' }, patch);

describe('collapsed assistant activity projection', () => {
  test('collects a whole turn across narration without hiding the response', () => {
    const input = [thinking('think-1'), message('narration', 'text', 'Checking sources'), tool('web_fetch'), thinking('think-2'), message('answer', 'text', 'The answer')];
    const output = projectTranscript(input, true);
    expect(output.map((row) => row.key)).toEqual(['activity:think-1', 'narration', 'answer']);
    const group = output[0]!;
    expect(group.kind === 'activity' && group.messages).toEqual([input[0]!, input[2]!, input[3]!]);
    expect(input.map((item) => item.key)).toEqual(['think-1', 'narration', 'web_fetch', 'think-2', 'answer']);
  });

  test('mobile omits tool calls and tool-only turns, including failures', () => {
    const input = [tool('read'), message('failed', 'tool_group', [{ name: 'search', error: 'failed' }]), thinking('think'), message('answer', 'text', 'Answer')];
    const output = projectTranscript(input, false);
    expect(output.map((row) => row.key)).toEqual(['activity:think', 'answer']);
    expect(output[0]!.kind === 'activity' && output[0]!.messages).toEqual([input[2]!]);
    expect(projectTranscript(input.slice(0, 2), false)).toEqual([]);
  });

  test('new user prompts and known turn ids never share a disclosure', () => {
    const input = [thinking('one', { turnId: 'a' }), thinking('two', { turnId: 'b' }), message('user', 'text', 'Next', { position: 'right' }), thinking('three')];
    expect(projectTranscript(input, true).map((row) => row.key)).toEqual(['activity:one', 'activity:two', 'user', 'activity:three']);
  });

  test('error notices and their recovery action remain standalone', () => {
    const notice = message('error', 'tips', { type: 'error', content: 'Retry', recovery: { kind: 'continue_truncated' } }, { position: 'center' });
    const output = projectTranscript([thinking('before'), notice, thinking('after')], true);
    expect(output.map((row) => row.key)).toEqual(['activity:before', 'error', 'activity:after']);
    expect(output[1]!.kind === 'message' && output[1]!.message).toBe(notice);
  });

  test('empty history activity produces no blank rows; active reasoning remains visible', () => {
    const empty = message('empty', 'thinking', { content: '', status: 'thinking' });
    const active = message('active', 'thinking', { content: '', status: 'thinking' }, { streaming: true });
    expect(projectTranscript([empty, message('tool', 'tool_group', [])], true)).toEqual([]);
    expect(projectTranscript([active], false).map((row) => row.key)).toEqual(['activity:active']);
  });

  test('appending streamed steps preserves the disclosure key and source content', () => {
    const first = thinking('first');
    const next = tool('second');
    const initial = projectTranscript([first], true);
    const updated = projectTranscript([first, next], true);
    expect(updated[0]!.key).toBe(initial[0]!.key);
    expect(updated[0]!.kind === 'activity' && updated[0]!.messages[0]).toBe(first);
    expect(initial[0]!.kind === 'activity' && initial[0]!.messages).toHaveLength(1);
  });
});
