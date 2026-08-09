/**
 * "Run now" delivery discipline, ported from the desktop
 * `cronRunNowDelivery.ts` — a mobile network is worse than a desktop one, so
 * this matters more here.
 *
 * `POST /api/cron/jobs/:id/run` requires an `Idempotency-Key`; the server turns
 * it into the operation id `http:{key}`, so a replayed key returns the existing
 * reservation instead of minting a second run.
 *
 * Rules:
 * - A pending key **always wins**: a lost response, a remount or a user retry
 *   reuses the exact same key.
 * - An in-process claim set stops two mounted screens submitting concurrently.
 * - Only the key whose HTTP response was accepted is cleared; on failure the
 *   in-flight claim is released but the persisted key is kept.
 *
 * Unlike desktop (which scopes this to `sessionStorage`), the key is persisted
 * with AsyncStorage: surviving an app restart is desirable on a phone.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { randomHex } from '@/api/utils';

const STORAGE_PREFIX = 'nomifun:cron-run-now:v1:';

/**
 * How long a not-yet-acknowledged key stays reusable. Long enough to cover a
 * lost response plus a manual retry, short enough that a permanently failed
 * POST cannot poison the button forever (a stale key would keep resolving to
 * the same server-side reservation and never fire a new run).
 */
const KEY_TTL_MS = 10 * 60_000;

/** Keys handed out but not yet resolved, so a second screen cannot double-fire. */
const inFlight = new Set<string>();
/** Mirror of the persisted keys, so a synchronous retry sees the pending one. */
const pending = new Map<string, string>();

function storageKey(cronJobId: string): string {
  return `${STORAGE_PREFIX}${cronJobId}`;
}

/**
 * Canonical UUIDv7: 48-bit big-endian millisecond timestamp, version 7,
 * variant 0b10, remaining bits random. The desktop bridge validates this shape
 * before sending, so we mint the same thing.
 */
export function uuidV7(): string {
  const bytes = new Uint8Array(16);
  const hex = randomHex(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);

  const ms = Date.now();
  bytes[0] = Math.floor(ms / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ms / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ms / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(ms / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10

  const s = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface StoredKey {
  key: string;
  at: number;
}

function readStored(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredKey>;
    if (typeof parsed.key !== 'string' || !UUID_V7.test(parsed.key)) return null;
    if (typeof parsed.at !== 'number' || Date.now() - parsed.at > KEY_TTL_MS) return null;
    return parsed.key;
  } catch {
    return null;
  }
}

/**
 * Claim the right to run this job. Returns null when another caller already
 * holds the claim (do nothing — a run is already on its way).
 */
export async function claimRunNow(cronJobId: string): Promise<string | null> {
  if (inFlight.has(cronJobId)) return null;
  inFlight.add(cronJobId);

  let key = pending.get(cronJobId);
  if (!key) {
    try {
      key = readStored(await AsyncStorage.getItem(storageKey(cronJobId))) ?? undefined;
    } catch {
      // Storage unavailable (private mode on web) — mint a fresh key instead.
    }
  }
  if (!key) {
    key = uuidV7();
    try {
      const record: StoredKey = { key, at: Date.now() };
      await AsyncStorage.setItem(storageKey(cronJobId), JSON.stringify(record));
    } catch {
      // Best effort: an unpersisted key still de-dupes within this session.
    }
  }
  pending.set(cronJobId, key);
  return key;
}

/** The POST was accepted — retire this key. */
export async function completeRunNow(cronJobId: string, key: string): Promise<void> {
  inFlight.delete(cronJobId);
  if (pending.get(cronJobId) !== key) return;
  pending.delete(cronJobId);
  try {
    await AsyncStorage.removeItem(storageKey(cronJobId));
  } catch {
    // A stale key is harmless: replaying it returns the same reservation.
  }
}

/** The POST failed — release the claim but keep the key for the retry. */
export function releaseRunNow(cronJobId: string): void {
  inFlight.delete(cronJobId);
}
