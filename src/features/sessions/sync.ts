export interface SessionSyncSource {
  onTopic: (topic: string, handler: (payload: unknown) => void) => () => void;
  onForeground: (handler: () => void) => () => void;
}

const SESSION_SYNC_TOPICS = [
  'ws.ready',
  'ws.reconnected',
  'conversation.listChanged',
  'agentSession.agentChanged',
  'agentSession.knowledgeChanged',
  'turn.started',
  'turn.completed',
] as const;

/** Delivery and foreground changes invalidate snapshots; only commands mutate. */
export function attachSessionSync(source: SessionSyncSource, reconcile: () => void): () => void {
  let active = true;
  const unsubscribe: Array<() => void> = [];
  const changed = () => {
    if (active) reconcile();
  };
  const stop = () => {
    if (!active) return;
    active = false;
    for (const remove of unsubscribe) remove();
  };
  try {
    for (const topic of SESSION_SYNC_TOPICS) unsubscribe.push(source.onTopic(topic, changed));
    unsubscribe.push(source.onForeground(changed));
    // Subscribe before starting the snapshot. Changes during its read reach the
    // catalog's dirty latch, and the first socket-ready closes the startup gap.
    changed();
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}
