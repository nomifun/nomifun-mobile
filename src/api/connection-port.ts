import { StaleConnectionError } from './types';

/** A retained client may clean up locally, but its old ports cannot call a new Desktop. */
export function scopeConnectionPort<T extends object>(port: T, currentEpoch: () => number, epoch: number): T {
  return new Proxy(port, { get(target, property) {
    const method = Reflect.get(target, property) as unknown;
    if (typeof method !== 'function') return method;
    return (...args: unknown[]) => {
      if (currentEpoch() !== epoch) throw new StaleConnectionError();
      return Reflect.apply(method, target, args);
    };
  } });
}
