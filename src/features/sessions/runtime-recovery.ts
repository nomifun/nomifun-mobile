import type { Conversation } from './api';

export interface ReconciledRuntime {
  activeTurnId: string | null;
  streaming: boolean;
  canSend: boolean;
  sawCompletion: boolean;
}

interface RuntimeRecoveryOptions {
  read: () => Promise<Conversation | undefined>;
  acceptance?: Promise<unknown> | null;
  generation: () => number;
  isCurrent: () => boolean;
  completedTurnIds: ReadonlySet<string>;
  apply: (runtime: ReconciledRuntime) => void;
}

/** A late snapshot cannot acquire authority over a newer observed turn. */
export async function reconcileRuntimeSnapshot(options: RuntimeRecoveryOptions): Promise<boolean> {
  const generation = options.generation();
  const current = () => options.isCurrent() && options.generation() === generation;
  if (!current()) return false;
  // A foreground GET must not declare idle before an already-submitted input
  // has reached its acceptance boundary.
  if (options.acceptance) await options.acceptance.catch(() => undefined);
  if (!current()) return false;
  let fresh: Conversation | undefined;
  try {
    fresh = await options.read();
  } catch {
    return false;
  }
  if (!current() || !fresh?.runtime) return false;
  const runtime = fresh.runtime;
  const turnId = runtime.active_turn_id?.trim() || null;
  if (runtime.is_processing === true && (!turnId || !options.completedTurnIds.has(turnId))) {
    options.apply({ activeTurnId: turnId, streaming: true, canSend: runtime.can_send_message ?? false, sawCompletion: false });
  } else {
    options.apply({ activeTurnId: null, streaming: false,
      canSend: runtime.is_processing === true ? true : runtime.can_send_message ?? true, sawCompletion: true });
  }
  return true;
}
