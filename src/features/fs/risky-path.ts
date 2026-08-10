/**
 * Pure workspace-path heuristics. No network, no React — safe to unit test and
 * safe for other features to reuse (the project-session screens warn with the
 * same rules).
 *
 * Why this lives on the client: the desktop does NOT constrain which directory
 * becomes a session workspace. `/api/fs/browse` allows the whole filesystem on
 * Unix, `POST /api/conversations` stores `extra.workspace` verbatim without
 * even checking that it exists, and the agent runs as the installation owner —
 * so a workspace is *not* a sandbox (docs/research/fs-browse-api.md §4, §7).
 * Picking `/` or `~` therefore deserves a warning, and nothing but the client
 * can raise it.
 *
 * These helpers only drive warning copy. They never block a selection.
 */

/** OS-owned trees: everything under them belongs to the system, not a project. */
const SYSTEM_ROOTS = ['/etc', '/usr', '/bin', '/system'] as const;

/** Credential stores — an agent with read/write here is a bad idea. */
const SENSITIVE_SEGMENTS = new Set(['.ssh', '.aws', '.gnupg']);

/** `\` → `/` so one set of rules covers Windows paths too. */
function toPosix(path: string): string {
  return path.replace(/\\/g, '/');
}

/** Drop trailing separators, keeping a bare root (`/`, `C:/`) intact. */
function trimTrailingSlashes(path: string): string {
  let out = path;
  while (out.length > 1 && out.endsWith('/') && !/^[A-Za-z]:\/$/.test(out)) {
    out = out.slice(0, -1);
  }
  return out;
}

/**
 * True when `path` is a place a user probably did not mean to hand an agent:
 * the filesystem root, a bare drive, the home directory itself, a system tree,
 * or anything under a credential directory.
 */
export function isRiskyWorkspacePath(path: string): boolean {
  if (typeof path !== 'string') return false;
  const raw = path.trim();
  if (raw === '') return false;

  const normalized = trimTrailingSlashes(toPosix(raw));
  const lower = normalized.toLowerCase();

  // Home directory itself (unexpanded form included — `~` never reaches the
  // conversation API, but manual input can produce it before resolution).
  if (normalized === '~') return true;

  // Filesystem root / bare drive letter.
  if (normalized === '/') return true;
  if (/^[A-Za-z]:$/.test(normalized) || /^[A-Za-z]:\/$/.test(normalized)) return true;

  // Windows system tree.
  if (/^[A-Za-z]:\/windows(\/|$)/.test(lower)) return true;

  // Unix system trees.
  for (const root of SYSTEM_ROOTS) {
    if (lower === root || lower.startsWith(`${root}/`)) return true;
  }

  // The account's home directory itself — a project should be a folder inside it.
  if (/^\/(home|users)\/[^/]+$/.test(lower)) return true;
  if (/^[A-Za-z]:\/users\/[^/]+$/.test(lower)) return true;
  if (lower === '/root') return true;

  // Credential stores, at any depth.
  for (const segment of normalized.split('/')) {
    if (SENSITIVE_SEGMENTS.has(segment.toLowerCase())) return true;
  }

  return false;
}

/**
 * True when any path component has leading/trailing whitespace.
 *
 * Port of the backend's `workspace_path_has_edge_whitespace_segment`: such a
 * path is a hard 400 (`WorkspacePathEdgeWhitespace`) at conversation create /
 * patch time, so the picker warns before the user gets that far. Interior
 * spaces (`Application Support`) are fine.
 */
export function hasEdgeWhitespaceSegment(path: string): boolean {
  if (typeof path !== 'string' || path === '') return false;
  return toPosix(path)
    .split('/')
    .some((segment) => segment !== '' && segment !== segment.trim());
}
