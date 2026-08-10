/**
 * Pure path math for the workspace file browser.
 *
 * `GET /api/conversations/:id/workspace` takes a *workspace-relative* path
 * (`'/'` for the root) and lists exactly one level, so the client owns the
 * walking. Kept dependency-free so it stays trivially testable.
 */

/** `path` is required and non-empty on the wire; the root is `'/'`. */
export const WORKSPACE_ROOT_PATH = '/';

/** Server-side `MAX_DIR_DEPTH`: deeper relative paths are rejected with 400. */
export const MAX_WORKSPACE_DEPTH = 10;

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
