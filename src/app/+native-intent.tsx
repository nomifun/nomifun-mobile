import { isPairingAppLink } from '@/api/pairing-intake';

/** Expo calls this for both cold-start and already-open native intents. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return isPairingAppLink(path) ? `/pair?payload=${encodeURIComponent(path)}` : path;
  } catch { return '/connect'; }
}
