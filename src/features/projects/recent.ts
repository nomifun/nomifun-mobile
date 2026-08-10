/**
 * "Recent projects" derivation for the directory picker.
 *
 * Deliberately server-derived: the recency list is just the conversation list
 * read through a different lens, so a project opened on the desktop (or on
 * another phone) shows up here without any local bookkeeping to sync — and a
 * deleted conversation drops out on its own. Nothing is persisted on device.
 *
 * Wire truth: `GET /api/conversations` returns rows ordered by `modified_at`
 * desc, with the workspace only ever in `extra.workspace`
 * (docs/research/project-sessions.md §1).
 */
import type { Conversation } from '@/features/sessions/api';
import {
  isCompanionConversation,
  isProjectConversation,
  workpathKey,
  workspaceDisplayNames,
} from '@/features/sessions/workpath';

/** Shape the `DirectoryPicker` `shortcuts` prop expects. */
export interface DirectoryShortcut {
  label: string;
  path: string;
}

export const RECENT_PROJECT_LIMIT = 5;

/**
 * Most recently touched project directories, newest first, deduplicated by
 * workpath.
 *
 * - `isProjectConversation` is the only admissible project test (non-empty
 *   `extra.workspace`, not an auto-provisioned temp workspace).
 * - Companion sessions pass that test — the server forces their
 *   `is_temporary_workspace` to false — but their workspace is a
 *   backend-managed per-companion directory, not a project the user picked, so
 *   they are excluded exactly as the session list excludes them from project
 *   sections.
 * - `path` is the server's own spelling (trimmed only): that string is what a
 *   later create/rebind must send back.
 * - Labels are disambiguated against each other, so two `src` directories do
 *   not both render as "src".
 *
 * @param label wraps the (disambiguated) directory name for display, so the
 *   caller owns the i18n.
 */
export function recentProjectShortcuts(
  conversations: readonly Conversation[],
  label: (name: string) => string,
  limit = RECENT_PROJECT_LIMIT,
): DirectoryShortcut[] {
  if (limit <= 0) return [];

  const candidates = conversations
    .filter((row) => isProjectConversation(row) && !isCompanionConversation(row))
    // The server already sorts by `modified_at` desc; re-sort so a caller that
    // merged pages (or an optimistic row) cannot break recency.
    .slice()
    .sort((a, b) => (b.modified_at ?? 0) - (a.modified_at ?? 0));

  const paths: { key: string; path: string }[] = [];
  const seen = new Set<string>();
  for (const row of candidates) {
    const path = (row.extra?.workspace ?? '').trim();
    const key = workpathKey(path);
    if (path === '' || seen.has(key)) continue;
    seen.add(key);
    paths.push({ key, path });
    if (paths.length >= limit) break;
  }

  const names = workspaceDisplayNames(paths.map((entry) => entry.key));
  return paths.map((entry) => ({
    label: label(names.get(entry.key) || entry.path),
    path: entry.path,
  }));
}
