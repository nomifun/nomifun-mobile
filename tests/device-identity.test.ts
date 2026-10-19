import { expect, test } from 'bun:test';
import { createDeviceIdentityStore, generateNativeInstallationKey, generateWebInstallationKey } from '@/api/device-identity-core';

function harness() {
  const saved = new Map<string, string>();
  let generated = 0;
  let write: (key: string, value: string) => Promise<void> = async (key, value) => { saved.set(key, value); };
  const storage = { get: async (key: string) => saved.get(key) ?? null, set: (key: string, value: string) => write(key, value) };
  const generate = () => (++generated).toString(16).padStart(64, '0');
  return { store: createDeviceIdentityStore(storage, generate), saved, storage, generate,
    generated: () => generated, setWrite: (next: typeof write) => { write = next; } };
}

test('concurrent initialization exposes one installation key only after its durable write', async () => {
  const h = harness();
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  h.setWrite((key, value) => new Promise<void>(resolve => {
    release = () => { h.saved.set(key, value); resolve(); }; started();
  }));
  let completed = 0;
  const first = h.store.getInstallationKey('desktop-a').then(value => { completed++; return value; });
  const second = h.store.getInstallationKey('desktop-a');
  await waiting;
  expect(h.generated()).toBe(1); expect(completed).toBe(0); expect(h.saved.size).toBe(0);
  release();
  expect(await first).toBe(await second); expect(h.saved.size).toBe(1);
});

test('restarts preserve identity while Desktop identities use independent storage keys', async () => {
  const h = harness();
  const first = await h.store.getInstallationKey('desktop-a');
  const restarted = createDeviceIdentityStore(h.storage, () => { throw new Error('Must reuse the saved identity'); });
  expect(await restarted.getInstallationKey('desktop-a')).toBe(first);
  expect(await h.store.getInstallationKey('desktop-b')).not.toBe(first);
  expect(h.generated()).toBe(2);
  await h.store.getInstallationKey('Desktop:/甲');
  await h.store.getInstallationKey('Desktop_003a_002f甲');
  expect(h.saved.size).toBe(4);
  expect([...h.saved.keys()].every(key => /^[a-zA-Z0-9._-]+$/.test(key))).toBe(true);
});

test('a failed write rejects every initializer and retry never reuses an undurable key', async () => {
  const h = harness();
  h.setWrite(async () => { throw new Error('Secure storage unavailable'); });
  const results = await Promise.allSettled([h.store.getInstallationKey('a'), h.store.getInstallationKey('a')]);
  expect(results.every(result => result.status === 'rejected')).toBe(true);
  expect(h.generated()).toBe(1); expect(h.saved.size).toBe(0);
  h.setWrite(async (key, value) => { h.saved.set(key, value); });
  expect(await h.store.getInstallationKey('a')).toBe('2'.padStart(64, '0'));
});

test('unreadable or malformed stored identity fails closed without silently registering a new device', async () => {
  let generated = 0;
  const unreadable = createDeviceIdentityStore({ get: async () => { throw new Error('Keystore unavailable'); }, set: async () => undefined }, () => { generated++; return 'a'.repeat(64); });
  expect((await unreadable.getInstallationKey('a').catch(error => error)).message).toBe('Keystore unavailable');
  const corrupt = createDeviceIdentityStore({ get: async () => 'truncated', set: async () => { throw new Error('Must not overwrite'); } }, () => { generated++; return 'a'.repeat(64); });
  expect((await corrupt.getInstallationKey('a').catch(error => error)).message).toBe('Stored device installation identity is invalid');
  expect(generated).toBe(0);
});

test('native installation keys use two validated OS UUID v4 values', () => {
  let calls = 0;
  const key = generateNativeInstallationKey(() => `ABCDEFAB-0000-4000-8000-${String(++calls).padStart(12, '0')}`);
  expect(calls).toBe(2); expect(key).toMatch(/^[0-9a-f]{64}$/);
  expect(key.slice(0, 32)).not.toBe(key.slice(32));
  expect(() => generateNativeInstallationKey(() => 'not-a-secure-uuid')).toThrow();
});

test('web generation needs only getRandomValues and rejects unavailable secure randomness', () => {
  const source = { getRandomValues: (bytes: Uint8Array) => { bytes.forEach((_, index) => { bytes[index] = index; }); return bytes; } } as Pick<Crypto, 'getRandomValues'>;
  expect(generateWebInstallationKey(source)).toBe('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
  expect(() => generateWebInstallationKey(undefined)).toThrow('A secure random source is required');
});
