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

/** Local receipt for the connection committed and verified by this auth intent. */
export interface ConnectionAuthResult {
  user: AuthUser;
  epoch: number;
}

export interface AuthLoginResponse {
  success: boolean;
  message?: string;
  user?: AuthUser;
  token?: string;
  device?: ConnectedDevice;
}

export interface ConnectedDevice {
  device_id: string;
  device_name: string;
  created_at_ms: number;
  last_seen_at_ms: number;
  revoked_at_ms: number | null;
}

export interface DesktopConnectionInfo {
  desktop_id: string;
  desktop_name: string;
  protocol_version: number;
  min_client_protocol: number;
  capabilities: string[];
}

export interface DesktopSystemInfo {
  storage_generation: string;
  agent_data_generation: number;
  platform: string;
  arch: string;
}

export interface ConnectionRoute {
  baseUrl: string;
  kind: 'direct' | 'relay' | 'site';
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
  desktop?: DesktopConnectionInfo;
  system?: DesktopSystemInfo;
  device?: ConnectedDevice;
  routes?: ConnectionRoute[];
  routeKind?: ConnectionRoute['kind'];
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

/** An old response cannot publish data into another Desktop/data generation. */
export class StaleConnectionError extends ApiError {
  constructor() {
    super('Connection changed while the request was in progress', 409, 'CONNECTION_CHANGED');
    this.name = 'StaleConnectionError';
  }
}
