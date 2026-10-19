import type { Conversation } from './api';
import { isCompanionConversation, isProjectConversation } from './workpath';

export type SessionScope = 'all' | 'pinned' | 'projects' | 'companions';

/** Display order for the loaded window. The catalog retains server cursors. */
export function orderConversationWindow(items: readonly Conversation[]): Conversation[] {
  return [...items].sort((a, b) =>
    Number(b.pinned === true) - Number(a.pinned === true) ||
    b.modified_at - a.modified_at || b.conversation_id.localeCompare(a.conversation_id),
  );
}

/** Filters the loaded projection only; pagination and ordering remain server-owned. */
export function filterConversations(
  items: readonly Conversation[],
  query: string,
  scope: SessionScope,
) {
  const needle = query.trim().toLocaleLowerCase();
  return items.filter((item) => {
    if (scope === 'pinned' && !item.pinned) return false;
    if (scope === 'companions' && !isCompanionConversation(item)) return false;
    if (scope === 'projects' && (!isProjectConversation(item) || isCompanionConversation(item)))
      return false;
    return (
      !needle ||
      [item.name, item.model?.use_model, item.model?.model, item.extra?.workspace].some((text) =>
        text?.toLocaleLowerCase().includes(needle),
      )
    );
  });
}
