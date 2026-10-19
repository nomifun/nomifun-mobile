/**
 * Project-session endpoints (workspace management on an existing conversation).
 *
 * A "project session" is nothing but a conversation whose `extra.workspace` is
 * a non-empty path outside the backend data dir — there is no project table,
 * no `project_id` and no project-scoped endpoint. Creation lives in
 * `@/features/sessions/api` (`createConversation`); this module owns the
 * read-only workspace listing on an existing row.
 *
 * Wire contract: docs/PROJECT-SESSIONS-CONTRACT.md.
 */
import { api } from '@/api/client';
import { agentSessionPath } from '@/features/sessions/api';

import { WORKSPACE_ROOT_PATH, workspaceRequestPath } from './paths';

/** One level of a workspace listing. The wire field really is called `type`. */
export interface WorkspaceEntry {
  name: string;
  /** `'directory'` or `'file'` — no size, no mtime, no recursion. */
  type: string;
}

/** Request path — also the SWR key for the listing hook. */
export function conversationWorkspaceKey(conversationId: string, path: string): string {
  const rel = workspaceRequestPath(path);
  return `${agentSessionPath(conversationId)}/workspace?path=${encodeURIComponent(rel)}`;
}

/**
 * `GET /api/agent-sessions/:id/workspace?path=/` — one directory level.
 * Children use the portable relative form (`path=src/app`), not `/src/app`.
 *
 * The workspace is a frozen resource binding: it is chosen at create time and
 * cannot be rebound afterwards, so this surface is read-only.
 *
 * Errors worth mapping (see `errors.ts`): 400 "no workspace" (the row has
 * none), 404 (the directory is not on disk — deliberately not a 500 so
 * polling clients do not produce error storms), 400 on `..` / depth > 10.
 */
export function listConversationWorkspace(
  conversationId: string,
  path: string = WORKSPACE_ROOT_PATH,
): Promise<WorkspaceEntry[]> {
  return api<WorkspaceEntry[]>(conversationWorkspaceKey(conversationId, path));
}

// ── File preview (`/api/fs/metadata` + `/api/fs/read`) ─────────────

export const FS_METADATA_PATH = '/api/fs/metadata';
export const FS_READ_PATH = '/api/fs/read';

/** `POST /api/fs/metadata` response (snake_case, `type` is the guessed MIME). */
export interface FileMetadata {
  name: string;
  path: string;
  /** Bytes. */
  size: number;
  /** Extension-guessed MIME; `application/octet-stream` when unknown. */
  type: string;
  last_modified: number;
  is_directory?: boolean;
}

/**
 * `POST /api/fs/metadata {path, workspace}` — size + guessed MIME of one file.
 *
 * `workspace` is the reason this works at all: the handler appends it to the
 * `allowed_roots` sandbox **for this request only**, so a project directory
 * outside the backend data dir becomes readable (`base_authority` in
 * `nomifun-file/src/service.rs`). Without it every project file answers 403.
 * Both fields are the complete body — the DTO is `deny_unknown_fields`.
 *
 * Failure modes: 403 outside the sandbox (or non-owner account), 400 when the
 * path cannot be resolved, 404 when metadata cannot be read.
 */
export function fileMetadata(path: string, workspace: string): Promise<FileMetadata> {
  return api<FileMetadata>(FS_METADATA_PATH, { body: { path, workspace } });
}

/**
 * `POST /api/fs/read {path, workspace}` — whole file as UTF-8 text.
 *
 * Returns `null` when the path is inside the sandbox but not on disk (the
 * server models "allowed but missing" as `data: null`, not as a 404).
 *
 * Two traps the caller must handle *before* calling: the server reads with
 * `fs::read_to_string`, so a non-UTF-8 file is a **500**, and its own size
 * ceiling is 256 MB, which is no protection for a phone — the whole file is
 * inlined into one JSON response. `classifyPreview` in `./preview` gates both.
 */
export function readTextFile(path: string, workspace: string): Promise<string | null> {
  return api<string | null>(FS_READ_PATH, { body: { path, workspace } });
}
