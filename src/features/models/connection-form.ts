/** Pure credential/connection form helpers shared by mobile sheets. */

import type { BedrockConfig, ProviderCredentials } from './types';

export const CONNECTION_ROLE_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

export const isValidConnectionRole = (role: string): boolean =>
  CONNECTION_ROLE_PATTERN.test(role.trim()) && role.trim() !== 'default';

export const AUTH_SCHEME_PRESETS = [
  'bearer',
  'token',
  'header_key:x-api-key',
  'header_key:x-goog-api-key',
  'header_key:xi-api-key',
  'query_key:key',
  'volc_voice',
] as const;

export type CredentialsKind = 'api_keys' | 'volc_voice' | 'custom';

export function credentialsKindForScheme(scheme: string): CredentialsKind {
  const value = scheme.trim();
  if (
    value === 'bearer' ||
    value === 'token' ||
    value.startsWith('header_key:') ||
    value.startsWith('query_key:')
  ) {
    return 'api_keys';
  }
  if (value === 'volc_voice') return 'volc_voice';
  return 'custom';
}

export function splitApiKeys(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export interface ConnectionCredentialsDraft {
  apiKeysText: string;
  appKey: string;
  accessKey: string;
  resourceId: string;
  rawJson: string;
}

export type ConnectionCredentialsResult =
  | { ok: true; credentials?: Record<string, unknown> }
  | { ok: false; error: 'volc_incomplete' | 'invalid_json' | 'json_not_object' };

export function buildConnectionCredentials(
  scheme: string,
  draft: ConnectionCredentialsDraft,
): ConnectionCredentialsResult {
  const kind = credentialsKindForScheme(scheme);
  if (kind === 'api_keys') {
    const keys = splitApiKeys(draft.apiKeysText);
    return keys.length > 0 ? { ok: true, credentials: { api_keys: keys } } : { ok: true };
  }
  if (kind === 'volc_voice') {
    const appKey = draft.appKey.trim();
    const accessKey = draft.accessKey.trim();
    const resourceId = draft.resourceId.trim();
    if (!appKey && !accessKey && !resourceId) return { ok: true };
    if (!appKey || !accessKey || !resourceId) {
      return { ok: false, error: 'volc_incomplete' };
    }
    return {
      ok: true,
      credentials: { app_key: appKey, access_key: accessKey, resource_id: resourceId },
    };
  }
  const raw = draft.rawJson.trim();
  if (!raw) return { ok: true };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'json_not_object' };
    }
    return { ok: true, credentials: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
}

export function buildApiKeyCredentials(text: string): Record<string, unknown> | undefined {
  const keys = splitApiKeys(text);
  return keys.length > 0 ? { api_keys: keys } : undefined;
}

export type BedrockAuthMethod = BedrockConfig['auth_method'];

export interface ProviderCredentialsDraft {
  isBedrock: boolean;
  mode: 'create' | 'update';
  hasStoredCredentials: boolean;
  apiKeysText?: string | null;
  bedrockAuthMethod?: BedrockAuthMethod | null;
  accessKeyId?: string | null;
  secretAccessKey?: string | null;
  sessionToken?: string | null;
}

export type ProviderCredentialsBuildResult =
  | { ok: true; credentials?: ProviderCredentials }
  | {
      ok: false;
      error:
        | 'api_keys_required'
        | 'bedrock_auth_method_required'
        | 'bedrock_access_keys_required'
        | 'bedrock_access_keys_incomplete';
    };

/**
 * Provider credentials use the same write-only typed JSON contract as named
 * connections. Empty update fields intentionally mean "keep the encrypted
 * value already stored"; secrets are never read back into the mobile client.
 */
export function buildProviderCredentials(
  draft: ProviderCredentialsDraft,
): ProviderCredentialsBuildResult {
  if (!draft.isBedrock) {
    const credentials = buildApiKeyCredentials(draft.apiKeysText ?? '');
    if (credentials) return { ok: true, credentials };
    if (draft.mode === 'update' && draft.hasStoredCredentials) return { ok: true };
    return { ok: false, error: 'api_keys_required' };
  }

  const method = draft.bedrockAuthMethod;
  if (!method) return { ok: false, error: 'bedrock_auth_method_required' };
  if (method === 'profile' || method === 'defaultChain') {
    return { ok: true, credentials: {} };
  }

  const accessKeyId = draft.accessKeyId?.trim() ?? '';
  const secretAccessKey = draft.secretAccessKey?.trim() ?? '';
  const sessionToken = draft.sessionToken?.trim() ?? '';
  if (!accessKeyId && !secretAccessKey && !sessionToken) {
    if (draft.mode === 'update' && draft.hasStoredCredentials) return { ok: true };
    return { ok: false, error: 'bedrock_access_keys_required' };
  }
  if (!accessKeyId || !secretAccessKey) {
    return { ok: false, error: 'bedrock_access_keys_incomplete' };
  }
  return {
    ok: true,
    credentials: {
      access_key_id: accessKeyId,
      secret_access_key: secretAccessKey,
      ...(sessionToken ? { session_token: sessionToken } : {}),
    },
  };
}

export function buildBedrockConfig(
  authMethod: BedrockAuthMethod,
  region: string,
  profile?: string | null,
): BedrockConfig {
  return {
    auth_method: authMethod,
    region: region.trim(),
    ...(authMethod === 'profile' ? { profile: profile?.trim() ?? '' } : {}),
  };
}

export function isVolcArkPlatform(platform: string): boolean {
  return platform === 'ark' || platform.startsWith('ark-') || platform.includes('volcengine');
}
