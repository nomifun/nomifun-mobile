/**
 * Pure path math for the workspace file browser.
 *
 * `GET /api/agent-sessions/:id/workspace` takes a *workspace-relative* path
 * (`'/'` for the root, `'src/app'` for a child) and lists exactly one level.
 * The browser's display stack keeps its leading slash; the request boundary
 * converts it to the desktop's portable relative form.
 */

/** `path` is required and non-empty on the wire; the root is `'/'`. */
export const WORKSPACE_ROOT_PATH = '/';

/** Server-side `MAX_DIR_DEPTH`: deeper relative paths are rejected with 400. */
export const MAX_WORKSPACE_DEPTH = 10;

/**
 * Convert the browser's `/src/app` breadcrumb path to the API's `src/app`.
 * Only the root may be `/` on the wire. Do not normalize traversal, repeated
 * separators or whitespace: the desktop owns validation of those candidates.
 */
export function workspaceRequestPath(path: string): string {
  if (path === '' || path === WORKSPACE_ROOT_PATH) return WORKSPACE_ROOT_PATH;
  return path.startsWith('/') ? path.slice(1) : path;
}

/** Non-empty segments of a workspace-relative path. */
export function workspaceSegments(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

/** `'/'` + `'src'` → `'/src'`; `'/src'` + `'app'` → `'/src/app'`. */
export function joinWorkspacePath(path: string, name: string): string {
  return `/${[...workspaceSegments(path), name].join('/')}`;
}

/** `'/src/app'` → `'/src'`; the root stays the root. */
export function parentWorkspacePath(path: string): string {
  const segments = workspaceSegments(path);
  segments.pop();
  return segments.length === 0 ? WORKSPACE_ROOT_PATH : `/${segments.join('/')}`;
}
