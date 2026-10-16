import { useEffect, useRef, useSyncExternalStore } from 'react';

import { nomifunSocket, type WsStatus } from '@/api/ws';

/** Live connection indicator for headers/banners. */
export function useWsStatus(): WsStatus {
  return useSyncExternalStore(
    (cb) => nomifunSocket.onStatus(() => cb()),
    () => nomifunSocket.getStatus(),
    () => nomifunSocket.getStatus(),
  );
}

/**
 * Subscribe to a wire topic while the component is mounted. The handler ref
 * is kept fresh without resubscribing on every render.
 */
export function useWsTopic(topic: string | string[], handler: (data: unknown) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const key = Array.isArray(topic) ? topic.join('|') : topic;

  useEffect(() => {
    const topics = key.split('|').filter(Boolean);
    const offs = topics.map((t) => nomifunSocket.on(t, (data) => handlerRef.current(data)));
    return () => {
      for (const off of offs) off();
    };
  }, [key]);
}
