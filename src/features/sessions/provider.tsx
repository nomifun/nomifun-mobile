import {
  createContext, useContext, useEffect, useMemo, useRef, useState,
  useSyncExternalStore, type PropsWithChildren,
} from 'react';
import { AppState, Platform } from 'react-native';
import { connectionStore } from '@/api/connection';
import { nomifunSocket } from '@/api/ws';
import {
  createConversation, deleteConversation, fetchConversation, fetchConversations,
  patchConversation, patchConversationModel,
} from './api';
import { createSessionData } from './data';
import { buildConversationGroups } from './workpath';
import { attachSessionSync } from './sync';
import { orderConversationWindow } from './presentation';

function useOwner() {
  const [epoch] = useState(connectionStore.epoch);
  const [recoveryVersion, setRecoveryVersion] = useState(0);
  const [owner] = useState(() => createSessionData({
    epoch,
    currentEpoch: connectionStore.epoch,
    fetchPage: fetchConversations,
    fetchOne: fetchConversation,
    create: createConversation,
    patch: patchConversation,
    remove: deleteConversation,
    setModel: patchConversationModel,
  }));
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const lifetime = useRef(0);

  useEffect(() => {
    const lease = ++lifetime.current;
    let active = true;
    const recovered = () => {
      if (active && lifetime.current === lease && connectionStore.epoch() === epoch) {
        setRecoveryVersion(version => version + 1);
      }
    };
    const stop = attachSessionSync({
      onTopic: (topic, handler) => nomifunSocket.on(topic, payload => {
        if (topic === 'ws.ready' || topic === 'ws.reconnected') recovered();
        handler(payload);
      }),
      onForeground: (handler) => {
        const resume = () => { recovered(); handler(); };
        const foreground = AppState.addEventListener('change', state => {
          if (state === 'active') resume();
        });
        const visible = () => { if (document.visibilityState === 'visible') resume(); };
        if (Platform.OS === 'web') {
          document.addEventListener('visibilitychange', visible);
          window.addEventListener('focus', visible);
          window.addEventListener('online', visible);
        }
        return () => {
          foreground.remove();
          if (Platform.OS === 'web') {
            document.removeEventListener('visibilitychange', visible);
            window.removeEventListener('focus', visible);
            window.removeEventListener('online', visible);
          }
        };
      },
    }, owner.reconcile);
    return () => {
      active = false;
      stop();
      // React can replay effects on the same owner in development. Dispose
      // after that replay, while a real unmount still aborts every old request.
      queueMicrotask(() => { if (lifetime.current === lease) owner.dispose(); });
    };
  }, [owner, epoch]);

  const items = useMemo(() => orderConversationWindow(snapshot.items), [snapshot.items]);
  const groups = useMemo(() => buildConversationGroups(items), [items]);
  return {
    ...snapshot, items, groups, epoch, recoveryVersion,
    isCurrent: () => connectionStore.epoch() === epoch,
    refresh: owner.refresh,
    retry: owner.markDirty,
    loadMore: owner.loadMore,
    create: owner.create,
    patch: owner.patch,
    remove: owner.remove,
    setModel: owner.setModel,
    reloadDetail: owner.reloadDetail,
    watchDetail: owner.watchDetail,
    isGenerating: (id: string) => snapshot.entities[id]?.runtime?.is_processing === true,
  };
}

type SessionDataValue = ReturnType<typeof useOwner>;
const SessionDataContext = createContext<SessionDataValue | null>(null);

/** One connection-scoped owner for every session list, selector and detail. */
export function SessionDataProvider({ children }: PropsWithChildren) {
  return <SessionDataContext.Provider value={useOwner()}>{children}</SessionDataContext.Provider>;
}

export function useSessionData() {
  const owner = useContext(SessionDataContext);
  if (!owner) throw new Error('SessionDataProvider is required');
  return owner;
}

export function useSessionDetail(id: string | undefined) {
  const owner = useSessionData();
  const { watchDetail, reloadDetail } = owner;
  useEffect(() => id ? watchDetail(id) : undefined, [id, watchDetail]);
  return {
    data: id ? owner.entities[id] : undefined,
    error: id ? owner.details[id]?.error : undefined,
    isLoading: !!id && !owner.entities[id] && owner.details[id]?.error === undefined,
    mutate: () => id ? reloadDetail(id) : Promise.resolve(undefined),
  };
}
