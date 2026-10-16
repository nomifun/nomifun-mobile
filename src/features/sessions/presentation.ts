import type { Conversation } from './api';
import { isCompanionConversation, isProjectConversation } from './workpath';

export type SessionScope = 'all' | 'pinned' | 'projects' | 'companions';

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
