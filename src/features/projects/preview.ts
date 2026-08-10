/**
 * Pure helpers for the read-only file preview.
 *
 * Server truths this encodes (`POST /api/fs/read`, `POST /api/fs/metadata` —
 * `crates/backend/nomifun-file/src/{routes,service,path_safety}.rs`):
 *
 * - Both bodies are `{path, workspace?}` with `deny_unknown_fields`. `path` is
 *   **absolute**; `workspace` is appended to the `allowed_roots` sandbox for
 *   that one request, which is the only reason a project directory outside the
 *   backend data dir is readable at all.
 * - `read` answers `data: string | null` — `null` means "inside the sandbox but
 *   not on disk", i.e. the file vanished between listing and tapping.
 * - `read` does `fs::read_to_string`, so a **non-UTF-8 file is a 500**, not an
 *   empty preview. Binary files must therefore be refused *before* the request.
 * - The server's own ceiling is 256 MB, which is useless as a phone guard: the
 *   whole file is inlined into a JSON response. Hence the much smaller limits
 *   below, checked against `metadata.size` first.
 *
 * `mime_guess` on the server is extension-based and does not know `.tsx`,
 * `.toml`, `.lock`… (and calls `.ts` a MPEG transport stream), so the text/binary
 * decision is made here from the file name, with the server MIME as a fallback
 * signal only.
 */

/** Refuse to even ask for a file bigger than this (bytes). */
export const MAX_PREVIEW_BYTES = 512 * 1024;

/** Hard cap on what gets rendered; the rest is dropped with a footer note. */
export const MAX_PREVIEW_CHARS = 20_000;

/** Extensions we are willing to render as text. Lower-case, without the dot. */
const TEXT_EXTENSIONS = new Set([
  // code
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'rs', 'py', 'go', 'java', 'kt', 'kts',
  'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'rb', 'php', 'lua', 'sh', 'bash',
  'zsh', 'fish', 'ps1', 'sql', 'r', 'dart', 'scala', 'clj', 'ex', 'exs', 'erl',
  'vue', 'svelte', 'astro',
  // markup / styles
  'html', 'htm', 'xml', 'svg', 'css', 'scss', 'sass', 'less', 'md', 'mdx',
  'markdown', 'rst', 'tex',
  // data / config
  'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env',
  'properties', 'lock', 'csv', 'tsv', 'txt', 'log', 'diff', 'patch', 'gitignore',
  'editorconfig', 'graphql', 'gql', 'proto',
]);

/** Extension-less files that are text by convention. */
const TEXT_FILENAMES = new Set([
  'readme', 'license', 'licence', 'changelog', 'authors', 'contributing',
  'makefile', 'dockerfile', 'procfile', 'codeowners', 'notice', 'todo',
]);

/** Server MIME prefixes/values that are text even when the name says nothing. */
const TEXT_MIME_EXACT = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/ecmascript',
  'application/x-sh',
  'application/x-yaml',
  'application/toml',
  'image/svg+xml',
]);

/** `'a.tar.gz'` → `'gz'`; `'.env'` → `''` (a leading dot is not an extension). */
export function fileExtension(name: string): string {
  const at = name.lastIndexOf('.');
  if (at <= 0) return '';
  return name.slice(at + 1).toLowerCase();
}

/** True when the *name* alone says this is text. */
export function isTextFileName(name: string): boolean {
  const base = name.trim();
  if (base === '') return false;
  const extension = fileExtension(base);
  if (extension !== '') return TEXT_EXTENSIONS.has(extension);
  // `.env`, `.gitignore`, `.editorconfig`: the whole name is the "extension".
  const bare = (base.startsWith('.') ? base.slice(1) : base).toLowerCase();
  return TEXT_FILENAMES.has(bare) || TEXT_EXTENSIONS.has(bare);
}

export type PreviewVerdict =
  | { kind: 'text' }
  | { kind: 'binary' }
  | { kind: 'tooLarge'; size: number }
  | { kind: 'empty' };

export interface PreviewCandidate {
  name: string;
  /** Bytes, from `POST /api/fs/metadata`. */
  size: number;
  /** Server MIME (extension-guessed); only consulted when the name is mute. */
  mime?: string;
  isDirectory?: boolean;
}

/**
 * Decide whether a file may be fetched. Order matters: size is checked before
 * text-ness so a 900 MB `.log` reads as "too large" rather than "text", and the
 * request is never made.
 */
export function classifyPreview(candidate: PreviewCandidate): PreviewVerdict {
  if (candidate.isDirectory === true) return { kind: 'binary' };
  const size = Number.isFinite(candidate.size) ? Math.max(0, candidate.size) : 0;
  const mime = (candidate.mime ?? '').toLowerCase();
  const looksText =
    isTextFileName(candidate.name) || mime.startsWith('text/') || TEXT_MIME_EXACT.has(mime);
  if (!looksText) return { kind: 'binary' };
  if (size > MAX_PREVIEW_BYTES) return { kind: 'tooLarge', size };
  if (size === 0) return { kind: 'empty' };
  return { kind: 'text' };
}

export interface PreviewText {
  text: string;
  truncated: boolean;
  /** Line count of the rendered slice (not of the file). */
  lines: number;
}

/**
 * Clip the fetched content for rendering. `\r\n` is normalized so a Windows
 * file does not render with a trailing box glyph per line, and a trailing
 * newline is dropped so the last line is not an empty one.
 */
export function truncatePreview(content: string, limit = MAX_PREVIEW_CHARS): PreviewText {
  const normalized = content.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  const truncated = normalized.length > limit;
  const text = truncated ? normalized.slice(0, limit) : normalized;
  return { text, truncated, lines: text === '' ? 0 : text.split('\n').length };
}

/** Human size, matching the desktop's unit set (KB/MB, one decimal). */
export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Absolute path of a file inside a conversation workspace.
 *
 * The workspace listing (`GET /api/conversations/:id/workspace`) is *relative*
 * while `/api/fs/read` wants an absolute path, so the two have to be joined
 * here. The separator follows the workspace itself: a Windows workspace comes
 * back as `C:\code\app`, and mixing separators inside one path is a needless
 * risk when the server just does `Path::new(path)`.
 *
 * `segments` are the browser's path stack; `name` the tapped entry.
 */
export function absoluteWorkspacePath(
  workspace: string,
  segments: readonly string[],
  name: string,
): string {
  const trimmed = workspace.trim().replace(/[/\\]+$/, '');
  const separator = trimmed.includes('\\') && !trimmed.includes('/') ? '\\' : '/';
  const parts = [...segments, name].filter((part) => part.length > 0);
  // A bare `/` workspace would otherwise produce `//a`.
  const base = trimmed === '' ? '' : trimmed;
  return [base, ...parts].join(separator) || separator;
}
