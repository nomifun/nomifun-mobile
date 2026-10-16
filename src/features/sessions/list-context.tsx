import { createContext, useContext } from 'react';
import type { ConversationListState } from './hooks';

export const SessionListContext = createContext<ConversationListState | null>(null);

export function useSessionList() {
  const list = useContext(SessionListContext);
  if (!list) throw new Error('SessionListContext is required');
  return list;
}
