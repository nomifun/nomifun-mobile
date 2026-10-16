import type { SendMessageResult } from './api';

/** A stop intent must never acquire a newer turn's authority while awaiting HTTP. */
export async function cancelObservedTurn(
  observedTurnId: string | null | undefined,
  acceptance: Promise<SendMessageResult> | null,
  cancel: (expectedTurnId: string) => Promise<unknown>,
): Promise<boolean> {
  let target = observedTurnId?.trim();
  if (!target && acceptance) {
    const receipt = await acceptance;
    if (receipt.completed === true) return true;
    target = receipt.msg_id;
  }
  if (!target) return false;
  await cancel(target);
  return true;
}
