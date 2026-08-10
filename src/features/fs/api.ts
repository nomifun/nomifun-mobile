/**
 * Desktop filesystem browsing (`/api/fs/*`) + `GET /api/system/info`.
 *
 * Contract facts that shape this module (docs/research/fs-browse-api.md):
 * - Browse DTOs are **camelCase** (`currentPath`, `isDirectory`), system info is
 *   **snake_case** (`work_dir`). Neither is normalized here — the wire shape is
 *   the type.
 * - The whole `/api/fs/*` group sits behind `protect_instance_owner`, so a
 *   logged-in but non-owner account gets a blanket 403 that has nothing to do
 *   with an expired session. The two must read differently to the user.
 * - `POST /api/conversations` never validates `extra.workspace`; a bad path only
 *   explodes when the CLI subprocess starts. So every path this app stores must
 *   come from a `currentPath` that the server already canonicalized — that is
 *   what {@link resolveDirectory} is for.
 * - Hidden entries (`.`-prefixed) are filtered out of listings server-side, but
 *   a hidden directory can still be *browsed* directly. Manual input is the only
 *   way to reach `~/.config/x`, and it works.
 *
 * Every function here throws {@link FsError}, whose `message` is already
 * localized and safe to render.
 */
import { api } from '@/api/client';
import { ApiError, AuthExpiredError } from '@/api/types';
import i18n from '@/i18n';

import { isRiskyWorkspacePath, hasEdgeWhitespaceSegment } from '@/features/fs/risky-path';
import type { BrowseEntry, BrowseResult, SystemInfo } from '@/features/fs/types';

export const FS_BROWSE_PATH = '/api/fs/browse';
export const FS_DIRECTORY_PATH = '/api/fs/directory';
export const SYSTEM_INFO_KEY = '/api/system/info';

export type { BrowseEntry, BrowseResult, SystemInfo };
export { isRiskyWorkspacePath, hasEdgeWhitespaceSegment };

/** Which endpoint failed — 400/403/404 mean different things per operation. */
export type FsErrorContext = 'browse' | 'create';

const tr = (key: string, vars?: Record<string, unknown>): string =>
  i18n.t(key, { ns: 'fs', ...vars });

/** An `/api/fs/*` failure whose `message` is already localized for display. */
export class FsError extends Error {
  /** HTTP status when the failure came from the server. */
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'FsError';
    this.status = status;
  }
}

/** Transport-level failure (desktop asleep, wrong LAN, request timeout). */
function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
  return /network request failed|failed to fetch|load failed|networkerror|timeout|aborted/i.test(
    error.message,
  );
}

function browseStatusText(status: number, message: string): string {
  switch (status) {
    // `list_directory` also answers 404 for an unreadable directory, so the copy
    // has to cover "gone" and "cannot open" at once.
    case 404:
      return tr('errors.notFound');
    case 400:
      return tr('errors.notDirectory');
    case 403:
      if (/csrf/i.test(message)) return tr('errors.csrf');
      if (/sandbox|outside/i.test(message)) return tr('errors.outsideSandbox');
      return tr('errors.ownerRequired');
    case 401:
      return tr('errors.authExpired');
    default:
      return message ? tr('errors.server', { message }) : tr('errors.unknown');
  }
}

function createStatusText(status: number, message: string): string {
  switch (status) {
    case 409:
      return tr('errors.nameExists');
    case 400:
      return /already exists/i.test(message) ? tr('errors.nameExists') : tr('errors.invalidName');
    case 404:
      return tr('errors.parentNotFound');
    case 403:
      if (/csrf/i.test(message)) return tr('errors.csrf');
      if (/sandbox|outside/i.test(message)) return tr('errors.outsideSandbox');
      // `create_dir` maps EACCES onto 403 too — that is the desktop OS user
      // lacking write permission, not a wrong account.
      if (/cannot create folder|permission/i.test(message)) return tr('errors.createDenied');
      return tr('errors.ownerRequired');
    default:
      return message ? tr('errors.server', { message }) : tr('errors.unknown');
  }
}

/**
 * Localized, user-readable text for any filesystem failure. Safe to call on an
 * error that is already an {@link FsError} (e.g. one surfaced through SWR).
 */
export function fsErrorMessage(error: unknown, context: FsErrorContext = 'browse'): string {
  if (error instanceof FsError) return error.message;
  if (error instanceof AuthExpiredError) return tr('errors.authExpired');
  if (error instanceof ApiError) {
    return context === 'create'
      ? createStatusText(error.status, error.message ?? '')
      : browseStatusText(error.status, error.message ?? '');
  }
  if (isNetworkFailure(error)) return tr('errors.network');
  return tr('errors.unknown');
}

/** Request wrapper that turns every failure into a localized {@link FsError}. */
async function fsRequest<T>(
  path: string,
  context: FsErrorContext,
  body?: Record<string, unknown>,
): Promise<T> {
  try {
    return await api<T>(path, body === undefined ? undefined : { body });
  } catch (error) {
    // Session expiry is handled globally (the store resets and the router
    // returns to /connect); keep the type so that path still works.
    if (error instanceof AuthExpiredError) throw error;
    const status = error instanceof ApiError ? error.status : undefined;
    throw new FsError(fsErrorMessage(error, context), status);
  }
}

/**
 * SWR cache key for one directory level — it *is* the request path, so the key
 * identifies exactly one server response and pull-to-refresh can revalidate it.
 */
export function browseKey(path = '', showFiles = false): string {
  return `${FS_BROWSE_PATH}?path=${encodeURIComponent(path)}&showFiles=${
    showFiles ? 'true' : 'false'
  }`;
}

/**
 * `GET /api/fs/browse?path=&showFiles=` — one directory level.
 *
 * `path` accepts `~` / `~/Documents` (expanded server-side). An empty path means
 * "server default": the desktop process cwd on Unix, the drive-list screen on
 * Windows (`isRoot: true`, `currentPath: ''`).
 */
export function browseDirectory(path?: string, showFiles?: boolean): Promise<BrowseResult> {
  return fsRequest<BrowseResult>(browseKey(path ?? '', showFiles ?? false), 'browse');
}

/**
 * `POST /api/fs/directory {parentPath, name}` — create one child folder.
 *
 * `name` must be a single path component; the server rejects anything else and
 * this refuses locally first so the user gets an instant, specific message.
 * Edge whitespace is refused as well: such a folder could never be used as a
 * workspace (`WorkspacePathEdgeWhitespace` is a 400 at conversation create).
 */
export async function createDirectory(parentPath: string, name: string): Promise<BrowseEntry> {
  // `async` so validation failures reject instead of throwing synchronously.
  if (!parentPath) throw new FsError(tr('errors.parentRequired'));
  if (name.trim() === '') throw new FsError(tr('errors.nameRequired'));
  if (name !== name.trim()) throw new FsError(tr('errors.nameEdgeWhitespace'));
  if (name === '.' || name === '..' || /[\\/\0]/.test(name)) {
    throw new FsError(tr('errors.invalidName'));
  }
  return fsRequest<BrowseEntry>(FS_DIRECTORY_PATH, 'create', { parentPath, name });
}

/**
 * Validate a hand-typed path and return the server's canonical form.
 *
 * This is the only safe way to accept typed input: browse is the de-facto
 * validator (404 missing, 400 not-a-directory, 403 outside the allow-list) and
 * its `currentPath` is the canonicalized, `~`-expanded, symlink-resolved
 * absolute path that must be stored instead of whatever the user typed.
 */
export async function resolveDirectory(input: string): Promise<string> {
  const raw = input.trim();
  if (raw === '') throw new FsError(tr('errors.emptyInput'));
  if (raw.includes('\0')) throw new FsError(tr('errors.notDirectory'));

  const result = await browseDirectory(raw, false);
  // The Windows drive page answers 200 with an empty `currentPath`; it is a
  // screen, not a directory, so it can never be a workspace.
  if (result.isRoot === true || !result.currentPath) {
    throw new FsError(tr('errors.notDirectory'));
  }
  return result.currentPath;
}

/**
 * `GET /api/system/info` — snake_case. Used for `work_dir` (the natural default
 * start directory) and `platform` (whether the Windows drive page exists).
 * Owner-only like the fs routes, so callers must tolerate failure.
 */
export function systemInfo(): Promise<SystemInfo> {
  return fsRequest<SystemInfo>(SYSTEM_INFO_KEY, 'browse');
}
