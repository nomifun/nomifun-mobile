import { ApiError, AuthExpiredError } from './types';
import { PairingOriginMismatchError } from './pairing';

export function connectionErrorKey(error: unknown): string {
  if (error instanceof PairingOriginMismatchError) return 'webOriginMismatch';
  if (error instanceof AuthExpiredError) return 'authRequired';
  if (error instanceof ApiError) {
    if (error.status === 429) return 'rateLimited';
    switch (error.code) {
      case 'DEVICE_PAIRING_EXPIRED': case 'DEVICE_PAIRING_USED': return 'qrExpired';
      case 'DEVICE_PAIRING_INVALID': return 'devicePairRequired';
      case 'DESKTOP_IDENTITY_UNAVAILABLE': return 'devicePairRequired';
      case 'CONNECTION_PROTOCOL_INCOMPATIBLE': case 'CONNECTION_GENERATION_UNAVAILABLE': return 'updateRequired';
      case 'DESKTOP_IDENTITY_CHANGED': return 'identityChanged';
      case 'PAIRING_ORIGIN_MISMATCH': return 'webOriginMismatch';
      case 'UNAUTHORIZED': case 'DEVICE_REVOKED': return 'authRequired';
      case 'FORBIDDEN': return 'permissionDenied';
      case 'CONNECTION_CHANGED': return 'connectionChanged';
      case 'CONNECTION_HTTPS_REQUIRED': return 'httpsRequired';
    }
    if (error.status === 404 || error.status === 426) return 'updateRequired';
    if (error.status === 401) return 'authRequired';
    if (error.status === 403) return 'permissionDenied';
  }
  return 'probeFailed';
}
