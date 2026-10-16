import { useEffect } from 'react';
import { useSWRConfig, type ScopedMutator } from 'swr';

let currentMutate: ScopedMutator | undefined;
/** Existing cross-feature invalidations follow the active isolated cache. */
export const mutateConnectionCache: ScopedMutator = ((...args: Parameters<ScopedMutator>) =>
  currentMutate ? currentMutate(...args) : Promise.resolve(undefined)) as ScopedMutator;
export function ConnectionCacheBridge() {
  const { mutate } = useSWRConfig();
  useEffect(() => {
    currentMutate = mutate;
    return () => { if (currentMutate === mutate) currentMutate = undefined; };
  }, [mutate]);
  return null;
}
