import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'nomifun.appearance';
let mode: ThemeMode = 'system';
let revision = 0;
let writes = Promise.resolve();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export const themeStore = {
  snapshot: () => mode,
  serverSnapshot: (): ThemeMode => 'system',
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  async hydrate() {
    const startedAt = revision;
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (startedAt !== revision || !['system', 'light', 'dark'].includes(saved ?? '')) return;
      mode = saved as ThemeMode;
      emit();
    } catch {
      // The system appearance remains usable when storage is unavailable.
    }
  },
  setMode(next: ThemeMode): Promise<void> {
    revision += 1;
    mode = next;
    emit();
    const write = writes.then(() => AsyncStorage.setItem(STORAGE_KEY, next));
    writes = write.catch(() => undefined);
    return write;
  },
};
