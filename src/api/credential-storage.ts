import type { ConnectionPersistence } from './connection-core';
import type { ServerBinding } from './types';

interface MetadataStorage { get(): Promise<string | null>; set(value: string): Promise<void> }
interface SecureCredentials { get(key: string): Promise<string | null>; set(key: string, token: string): Promise<void>; remove(key: string): Promise<void> }
type Metadata = Omit<ServerBinding, 'token'> & { token?: string; credentialKey?: string };

/** The metadata pointer commits last, so a failed write cannot bind a new token to an old Desktop. */
export function createCredentialPersistence(metadata: MetadataStorage, secure: SecureCredentials, newKey: () => string): ConnectionPersistence {
  return {
    async read() {
      const raw = await metadata.get();
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Metadata;
      if (parsed.token) {
        const key = newKey(); await secure.set(key, parsed.token);
        try { await metadata.set(JSON.stringify({ ...parsed, token: undefined, credentialKey: key })); }
        catch (error) { await secure.remove(key).catch(() => undefined); throw error; }
        return { ...parsed, token: parsed.token } as ServerBinding;
      }
      return { ...parsed, token: parsed.credentialKey ? await secure.get(parsed.credentialKey) ?? '' : '' } as ServerBinding;
    },
    async write(binding) {
      const raw = await metadata.get();
      const previous = raw ? JSON.parse(raw) as Metadata : undefined;
      const previousToken = previous?.credentialKey ? await secure.get(previous.credentialKey) : null;
      const key = binding.token ? (previous?.credentialKey && previousToken === binding.token ? previous.credentialKey : newKey()) : undefined;
      if (key && key !== previous?.credentialKey) await secure.set(key, binding.token);
      try { await metadata.set(JSON.stringify({ ...binding, token: undefined, credentialKey: key })); }
      catch (error) {
        if (key && key !== previous?.credentialKey) await secure.remove(key).catch(() => undefined);
        throw error;
      }
      if (previous?.credentialKey && previous.credentialKey !== key) await secure.remove(previous.credentialKey).catch(() => undefined);
    },
  };
}
