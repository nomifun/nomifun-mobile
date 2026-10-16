import { expect, test } from 'bun:test';
import { createCredentialPersistence } from '@/api/credential-storage';
const binding = { baseUrl: 'https://a.test', token: 'secret-a', user: null };
function harness() {
  let raw: string | null = null; let fail = false; let sequence = 0;
  const credentials = new Map<string, string>();
  const persistence = createCredentialPersistence({ get: async () => raw, set: async value => { if (fail) throw new Error('disk failed'); raw = value; } },
    { get: async key => credentials.get(key) ?? null, set: async (key, token) => { credentials.set(key, token); }, remove: async key => { credentials.delete(key); } }, () => `credential-${++sequence}`);
  return { persistence, credentials, raw: () => raw, legacy: () => { raw = JSON.stringify(binding); }, fail: () => { fail = true; } };
}
test('native metadata never contains the plaintext credential', async () => {
  const h = harness(); await h.persistence.write(binding);
  expect(h.raw()?.includes('secret-a')).toBe(false); expect((await h.persistence.read())?.token).toBe('secret-a');
  await h.persistence.write({ ...binding, token: '' }); expect(h.credentials.size).toBe(0);
});
test('failed metadata commit preserves the previous Desktop and token pair', async () => {
  const h = harness(); await h.persistence.write(binding); h.fail();
  await h.persistence.write({ ...binding, baseUrl: 'https://b.test', token: 'secret-b' }).catch(() => undefined);
  const loaded = await h.persistence.read(); expect(loaded?.baseUrl).toBe('https://a.test'); expect(loaded?.token).toBe('secret-a');
  expect(h.credentials.size).toBe(1);
});
test('legacy token migrates only after durable secure storage succeeds', async () => {
  const h = harness(); h.legacy(); expect((await h.persistence.read())?.token).toBe('secret-a');
  expect(h.raw()?.includes('secret-a')).toBe(false);
});
