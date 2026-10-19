import { ApiError } from '@/api/types';
import i18n from '@/i18n';

export function isStaleSessionError(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'CONNECTION_CHANGED';
}

export function sessionErrorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.code === 'INVALID_API_RESPONSE') return i18n.t('errors.protocol', { ns: 'sessions' });
    if (error.code === 'SESSION_CREATION_BUSY') return i18n.t('errors.creating', { ns: 'sessions' });
    if (error.code === 'SESSION_CREATION_PENDING_LIMIT') return i18n.t('errors.pendingCreation', { ns: 'sessions' });
    if (error.code === 'SESSION_RESOURCE_MANIFEST_UNAVAILABLE') return i18n.t('create.resourceManifestUnavailable', { ns: 'sessions' });
    if (error.code === 'SESSION_RESOURCE_SELECTION_REQUIRED') {
      const kinds = 'kinds' in error && Array.isArray(error.kinds)
        ? error.kinds.filter((value): value is string => typeof value === 'string').join(', ') : '';
      return i18n.t('create.resourceSelectionRequired', { ns: 'sessions', kinds });
    }
  }
  return error instanceof Error ? error.message : fallback;
}
