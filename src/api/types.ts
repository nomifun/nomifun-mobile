/**
 * Wire types shared across the API layer.
 *
 * The nomifun server speaks a stable envelope on /api/*:
 *   { success: boolean, data?: T, message?: string }
 * Auth endpoints (/login, /api/auth/qr-login, /api/auth/setup) return a flat
 * shape instead: { success, user, token, message }.
 */

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
}

export interface AuthUser {
  user_id: string;
  username: string;
}

export interface AuthLoginResponse {
  success: boolean;
  message?: string;
  user?: AuthUser;
  token?: string;
}

export interface AuthStatusResponse {
  success: boolean;
  needs_setup: boolean;
  user_count: number;
  is_authenticated: boolean;
}

/** Persisted description of the desktop server the phone is bound to. */
export interface ServerBinding {
  /** Absolute origin on native (http://192.168.1.42:25808); '' on web (same-origin). */
  baseUrl: string;
  /** 30-day JWT from qr-login / password login. */
  token: string;
  user: AuthUser | null;
  /** Self-generated hex64 used for the CSRF double-submit pair. */
  csrfToken: string;
  /** ui-api-contract-version reported by the server, if known. */
  contractVersion?: number;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Thrown when the server said our JWT is gone — UI should return to /connect. */
export class AuthExpiredError extends ApiError {
  constructor(message = 'Authentication expired') {
    super(message, 403, 'FORBIDDEN');
    this.name = 'AuthExpiredError';
  }
}
