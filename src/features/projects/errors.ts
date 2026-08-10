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
