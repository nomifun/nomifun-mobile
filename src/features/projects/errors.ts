/**
 * Server-error classification for workspace calls.
 *
 * The HTTP client keeps the server's machine code (`ApiError.code`) and its
 * English message, so every predicate here matches on the code first and falls
 * back to the message shape for older servers.
 */
import { ApiError } from '@/api/types';

function message(err: unknown): string {
  return err instanceof Error ? err.message : '';
}

/**
 * A path segment starts/ends with whitespace →
 * 400 `WORKSPACE_PATH_EDGE_WHITESPACE_UNSUPPORTED` (create) or
 * `..._RUNTIME_UNSUPPORTED` (send/warmup). Interior spaces are fine.
 */
export function isEdgeWhitespacePathError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.code?.startsWith('WORKSPACE_PATH_EDGE_WHITESPACE')) return true;
  return err.status === 400 && /whitespace/i.test(err.message);
}

/**
 * `/api/fs/*` sits behind `protect_instance_owner`, and a non-owner PATCH has
 * its `extra` silently dropped — so a 403 here means "this account cannot touch
 * the desktop file system", not "the token expired" (auth expiry is turned into
 * `AuthExpiredError` and handled globally).
 */
export function isNotInstallOwnerError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}

/** 404 from the workspace listing = the directory is not on disk (yet). */
export function isWorkspaceDirectoryMissingError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

/** 400 "Conversation has no workspace assigned" — the row has no workspace. */
export function isWorkspaceUnassignedError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 400 && /no workspace/i.test(err.message);
}

/**
 * Localized message for a failed create / rebind. Callers pass the three
 * strings so this stays free of `t` typing and unit-testable.
 */
export function workspaceErrorMessage(
  err: unknown,
  labels: { edgeWhitespace: string; notOwner: string; fallback: string },
): string {
  if (isEdgeWhitespacePathError(err)) return labels.edgeWhitespace;
  if (isNotInstallOwnerError(err)) return labels.notOwner;
  return message(err) || labels.fallback;
}

/** Why a file preview could not be produced — one i18n key each. */
export type PreviewFailure = 'forbidden' | 'unreadable' | 'notFound' | 'unknown';

/**
 * Classify a `/api/fs/metadata` or `/api/fs/read` failure.
 *
 * - 403 — outside the request's sandbox (`allowed_roots ∪ workspace`, so a
 *   symlink pointing out of the project), or the account is not the install
 *   owner. Either way the phone cannot fix it.
 * - 400 / 404 — `canonicalize` failed: gone since the listing, or a broken
 *   symlink. Not an error worth a red banner.
 * - 500 `cannot read file` — the server reads with `fs::read_to_string`, so
 *   this is a non-UTF-8 file that slipped past the extension gate.
 */
export function previewFailureKind(err: unknown): PreviewFailure {
  if (!(err instanceof ApiError)) return 'unknown';
  if (err.status === 403) return 'forbidden';
  if (err.status === 400 || err.status === 404) return 'notFound';
  if (err.status >= 500 && /cannot read file|invalid utf|stream did not contain/i.test(err.message)) {
    return 'unreadable';
  }
  return 'unknown';
}
