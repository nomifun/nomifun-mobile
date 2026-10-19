import type { DesktopConnectionInfo, DesktopSystemInfo, ServerBinding } from './types';
import { ApiError } from './types';

export const CLIENT_CONNECTION_PROTOCOL = 2;

export function isLocalConnectionAddress(baseUrl: string): boolean {
  if (!baseUrl) return true;
  const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
  // URL already validates the literal; a DNS name beginning with fc/fd is not a LAN address.
  if (host.includes(':') && (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host))) return true;
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || !parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 169 && parts[1] === 254);
}

export function requireSecureConnectionAddress(baseUrl: string): void {
  if (baseUrl && !isLocalConnectionAddress(baseUrl) && new URL(baseUrl).protocol !== 'https:') {
    throw new ApiError('Remote connections require HTTPS', 400, 'CONNECTION_HTTPS_REQUIRED');
  }
}

export function validateDesktopInfo(value: unknown): DesktopConnectionInfo {
  const info = value as Partial<DesktopConnectionInfo> | null;
  if (!info || typeof info.desktop_id !== 'string' || !info.desktop_id.trim() ||
      typeof info.desktop_name !== 'string' || !Number.isSafeInteger(info.protocol_version) ||
      !Number.isSafeInteger(info.min_client_protocol) || !Array.isArray(info.capabilities) ||
      !info.capabilities.every(item => typeof item === 'string')) {
    throw new ApiError('The Desktop does not provide a valid connection identity', 426, 'CONNECTION_PROTOCOL_INCOMPATIBLE');
  }
  if (info.protocol_version !== CLIENT_CONNECTION_PROTOCOL ||
      info.min_client_protocol! > CLIENT_CONNECTION_PROTOCOL || !info.capabilities.includes('agent_session')) {
    throw new ApiError('Update Mobile or Desktop to a compatible connection version', 426, 'CONNECTION_PROTOCOL_INCOMPATIBLE');
  }
  return info as DesktopConnectionInfo;
}

export function validateSystemInfo(value: unknown): DesktopSystemInfo {
  const info = value as Partial<DesktopSystemInfo> | null;
  if (!info || typeof info.storage_generation !== 'string' ||
      !info.storage_generation.trim() || info.storage_generation === 'uninitialized' ||
      !Number.isSafeInteger(info.agent_data_generation) || info.agent_data_generation! <= 0 ||
      typeof info.platform !== 'string' || typeof info.arch !== 'string') {
    throw new ApiError('The Desktop data identity is unavailable', 426, 'CONNECTION_GENERATION_UNAVAILABLE');
  }
  return { storage_generation: info.storage_generation, agent_data_generation: info.agent_data_generation!,
    platform: info.platform, arch: info.arch };
}

export function connectionNamespace(binding: ServerBinding): string {
  return JSON.stringify([binding.desktop?.desktop_id ?? binding.baseUrl, binding.system?.storage_generation,
    binding.system?.agent_data_generation, binding.user?.user_id, binding.device?.device_id]);
}

export function assertDesktopIdentity(expected: DesktopConnectionInfo | undefined, actual: DesktopConnectionInfo): void {
  if (expected && expected.desktop_id !== actual.desktop_id) {
    throw new ApiError('This address belongs to a different Desktop; pair with it explicitly', 409, 'DESKTOP_IDENTITY_CHANGED');
  }
}
