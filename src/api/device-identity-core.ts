/** Installation identity belongs to one app install and one Desktop, not a login. */
export interface DeviceIdentityStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export const isInstallationKey = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

/** SecureStore keys permit only letters, digits, dots, dashes and underscores. */
function storageKey(desktopId: string): string {
  if (!desktopId) throw new Error('A Desktop identity is required');
  let encoded = '';
  for (let index = 0; index < desktopId.length; index++) {
    encoded += desktopId.charCodeAt(index).toString(16).padStart(4, '0');
  }
  return `nomifun.installation.v1.${encoded}`;
}

/** Native UUID v4 uses the OS random source; two UUIDs contain 244 random bits. */
export function generateNativeInstallationKey(uuid: () => string): string {
  return [uuid(), uuid()].map(value => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new Error('The secure UUID source returned an invalid installation identity');
    }
    return value.replace(/-/g, '').toLowerCase();
  }).join('');
}

/** getRandomValues remains available to HTTP LAN pages; never fall back to Math.random. */
export function generateWebInstallationKey(cryptoApi: Pick<Crypto, 'getRandomValues'> | undefined): string {
  if (!cryptoApi?.getRandomValues) throw new Error('A secure random source is required for device identity');
  const bytes = cryptoApi.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

/** Initialization is shared per Desktop. No key is usable before its durable write succeeds. */
export function createDeviceIdentityStore(storage: DeviceIdentityStorage, generate: () => string | Promise<string>) {
  const pending = new Map<string, Promise<string>>();
  return {
    async getInstallationKey(desktopId: string): Promise<string> {
      const key = storageKey(desktopId);
      let operation = pending.get(desktopId);
      if (!operation) {
        operation = (async () => {
          const saved = await storage.get(key);
          if (saved !== null) {
            if (!isInstallationKey(saved)) throw new Error('Stored device installation identity is invalid');
            return saved;
          }
          const generated = await generate();
          if (!isInstallationKey(generated)) throw new Error('Generated device installation identity is invalid');
          await storage.set(key, generated);
          return generated;
        })();
        pending.set(desktopId, operation);
      }
      try { return await operation; }
      finally { if (pending.get(desktopId) === operation) pending.delete(desktopId); }
    },
  };
}
