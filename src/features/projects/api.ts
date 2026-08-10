/**
 * Project-session endpoints (workspace management on an existing conversation).
 *
 * A "project session" is nothing but a conversation whose `extra.workspace` is
 * a non-empty path outside the backend data dir — there is no project table,
 * no `project_id` and no project-scoped endpoint. Creation lives in
 * `@/features/sessions/api` (`createConversation`); this module owns the two
 * calls that only make sense *after* a row exists.
 *
 * Wire truth: docs/research/project-sessions.md §3 and
 * docs/research/workspace-runtime.md §3.
 */
import { api } from '@/api/client';
import { conversationPath } from '@/features/sessions/api';

import { WORKSPACE_ROOT_PATH } from './paths';

/** One level of a workspace listing. The wire field really is called `type`. */
export interface WorkspaceEntry {
  name: string;
  /** `'directory'` or `'file'` — no size, no mtime, no recursion. */
  type: string;
}

/** Request path — also the SWR key for the listing hook. */
export function conversationWorkspaceKey(conversationId: string, path: string): string {
  const rel = path && path.length > 0 ? path : WORKSPACE_ROOT_PATH;
  return `${conversationPath(conversationId)}/workspace?path=${encodeURIComponent(rel)}`;
}

/**
 * `GET /api/conversations/:id/workspace?path=/` — one directory level.
 *
 * Errors worth mapping (see `errors.ts`): 400 "no workspace assigned" (the row
 * has none), 404 (the directory is not on disk — deliberately not a 500 so
 * polling clients do not produce error storms), 400 on `..` / depth > 10.
 */
export function listConversationWorkspace(
  conversationId: string,
  path: string = WORKSPACE_ROOT_PATH,
): Promise<WorkspaceEntry[]> {
  return api<WorkspaceEntry[]>(conversationWorkspaceKey(conversationId, path));
}

/**
 * `PATCH /api/conversations/:id` with **exactly** `{extra:{workspace}}`.
 *
 * `extra` is merge (patch) semantics server-side, so every other key survives.
 * Three things must NOT be added to this body:
 *
 * - `merge_extra` — the update DTO is `deny_unknown_fields`, so it 400s. (The
 *   desktop sends it from four call sites and its "set working directory"
 *   button is probably broken because of it.)
 * - `custom_workspace` — a pure front-end hint; the server derives its own
 *   flag from `workspace` being non-empty.
 * - `temp_workspace_id` — see below.
 *
 * **Only call this for rows that are already project sessions.** A session on
 * an auto-provisioned workspace keeps a `temp_workspace_id` marker in `extra`,
 * and every read re-derives `extra.workspace` from it: the PATCH is accepted
 * and even echoed back, then the next GET silently restores the old temp path.
 * "Clearing the marker as well" is worse than useless — the server's
 * `merge_json` is a plain insert that does not delete null keys, so
 * `{temp_workspace_id: null}` leaves the key present but unreadable and the
 * row then answers **500 on every GET/list**. Converting a temporary session
 * into a project session means creating a new conversation.
 *
 * Side effect on success: the workspace change terminates that conversation's
 * cached agent runtime (its cwd was baked in at build time), so the new
 * directory only takes effect from the next message on. The UI must say so.
 */
export function patchConversationWorkspace(
  conversationId: string,
  workspace: string,
): Promise<unknown> {
  return api<unknown>(conversationPath(conversationId), {
    method: 'PATCH',
    body: { extra: { workspace } },
  });
}
