/**
 * Wire types for the desktop filesystem browser (`/api/fs/browse`,
 * `/api/fs/directory`, `/api/system/info`).
 *
 * Mirrors `crates/backend/nomifun-api-types/src/file.rs` (browse DTOs are
 * **camelCase** on the wire) and `.../lifecycle.rs` (system info is
 * **snake_case**). See docs/research/fs-browse-api.md.
 */

/** One directory (or file, when `showFiles=true`) inside a browsed level. */
export interface BrowseEntry {
  name: string;
  /** Absolute path, ready to hand back to the next browse call. */
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  size?: number;
  /** Unix epoch milliseconds; absent for entries without readable metadata. */
  modified?: number;
}

/** One level of the directory tree. */
export interface BrowseResult {
  /** Canonicalized absolute path of the listed directory; `''` on the Windows drive page. */
  currentPath: string;
  /** Parent to navigate to; `'__ROOT__'` means "back to the Windows drive page". */
  parentPath?: string;
  items: BrowseEntry[];
  /** False when the parent is outside the server's browse allow-list. */
  canGoUp: boolean;
  /** True when the server clipped the listing at {@link MAX_BROWSE_ITEMS}. */
  truncated: boolean;
  /** True only for the Windows drive-list screen. */
  isRoot?: boolean;
}

/** `GET /api/system/info` — snake_case, unlike every other type in this file. */
export interface SystemInfo {
  cache_dir?: string;
  /** Root the desktop keeps conversation workspaces under. */
  work_dir?: string;
  log_dir?: string;
  storage_generation?: string;
  /** `darwin` | `win32` | `linux`. */
  platform?: string;
  arch?: string;
}

/**
 * `parentPath` sentinel meaning "return to the Windows drive-list screen"
 * (`browse.rs` `ROOT_SENTINEL`). Also accepted as a `path` value there.
 */
export const WINDOWS_ROOT_SENTINEL = '__ROOT__';

/** Server-side cap per directory (`browse.rs` `MAX_BROWSE_ITEMS`); no pagination exists. */
export const MAX_BROWSE_ITEMS = 500;
