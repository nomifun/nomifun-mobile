/** Pure helpers shared by camera intake and app deep-link intake. */
export type PairingAttemptStatus = 'ready' | 'pending' | 'failed' | 'succeeded';

/**
 * Recognize app links that belong to the pairing flow. Validation and origin
 * checks remain in pairing.ts so malformed pairing links can show a useful
 * error instead of being treated as unrelated navigation.
 */
export function isPairingAppLink(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw.trim());
    return (url.protocol === 'nomifun:' || url.protocol === 'nomi:') && url.hostname === 'pair';
  } catch {
    return false;
  }
}

/**
 * Acquire synchronously before parsing or awaiting anything. Camera callbacks
 * and duplicate cold/warm app-link deliveries can otherwise consume a ticket
 * more than once. Failure remains locked until an explicit rescan; success
 * remains locked for this intake instance. No raw link or token is retained.
 */
export class PairingAttemptLock {
  private currentStatus: PairingAttemptStatus = 'ready';

  get status(): PairingAttemptStatus {
    return this.currentStatus;
  }

  tryStart(): boolean {
    if (this.currentStatus !== 'ready') return false;
    this.currentStatus = 'pending';
    return true;
  }

  fail(): void {
    if (this.currentStatus === 'pending') this.currentStatus = 'failed';
  }

  succeed(): void {
    if (this.currentStatus === 'pending') this.currentStatus = 'succeeded';
  }

  resetForRescan(): boolean {
    if (this.currentStatus !== 'failed') return false;
    this.currentStatus = 'ready';
    return true;
  }
}
