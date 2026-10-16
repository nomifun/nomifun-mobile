import { ApiError } from '@/api/types';

/** Server message when we have one, otherwise the caller's localized fallback. */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

/**
 * `DELETE /api/providers/{id}` answers 409 `PROVIDER_IN_USE` with a
 * `details.usages[]` payload. Our HTTP client does not surface `details`, so we
 * detect the code and point the user at the desktop to unbind.
 */
export function isProviderInUse(err: unknown): boolean {
  return err instanceof ApiError && (err.code === 'PROVIDER_IN_USE' || err.status === 409);
}

/**
 * Client-preference keys registered as required Provider references answer 409
 * when the referenced (provider_id, model) no longer exists.
 */
export function isReferenceConflict(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409;
}
