import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

let reduced = true;
let generation = 0;
let revision = 0;
let subscription: ReturnType<typeof AccessibilityInfo.addEventListener> | undefined;
const listeners = new Set<() => void>();

function update(value: boolean) {
  revision += 1;
  if (reduced === value) return;
  reduced = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    const current = ++generation;
    const startedAt = revision;
    subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', update);
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (generation === current && revision === startedAt) update(value);
      })
      .catch(() => undefined);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      generation += 1;
      subscription?.remove();
      subscription = undefined;
    }
  };
}

/** Controls share a single system listener, even in a long virtualized list. */
export function useReducedMotion() {
  return useSyncExternalStore(
    subscribe,
    () => reduced,
    () => true,
  );
}
