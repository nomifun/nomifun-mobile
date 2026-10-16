import { thinkingBody, toolEntries, type ChatMessage } from './stream';

export type TranscriptItem =
  | { kind: 'message'; key: string; createdAt: number; message: ChatMessage }
  | { kind: 'activity'; key: string; createdAt: number; messages: ChatMessage[] };

/** One disclosure per assistant turn, including activity separated by narration.
 * This is a display projection only: messages, tool states and notices stay server-owned.
 */
export function projectTranscript(
  messages: readonly ChatMessage[],
  showTools: boolean,
): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let activity: Extract<TranscriptItem, { kind: 'activity' }> | undefined;
  let turnId: string | undefined;

  for (const message of messages) {
    if (message.position === 'right' || message.position === 'center' || message.position === 'pop') {
      activity = undefined;
      turnId = undefined;
    }
    if (message.turnId && turnId && message.turnId !== turnId) activity = undefined;
    turnId = message.turnId || turnId;

    if (message.type === 'thinking') {
      const body = thinkingBody(message.content);
      if (!body.content?.trim() && !message.streaming) continue;
    } else if (message.type === 'tool_call' || message.type === 'tool_group') {
      if (!showTools || !toolEntries(message).some((entry) => entry?.name || entry?.description)) {
        continue;
      }
    } else {
      items.push({ kind: 'message', key: message.key, createdAt: message.createdAt, message });
      continue;
    }

    if (!activity) {
      activity = {
        kind: 'activity',
        key: `activity:${message.key}`,
        createdAt: message.createdAt,
        messages: [],
      };
      items.push(activity);
    }
    activity.messages.push(message);
  }
  return items;
}
