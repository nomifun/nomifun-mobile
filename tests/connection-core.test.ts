import { expect, test } from 'bun:test';
import { createConnectionStore } from '@/api/connection-core';
import type { ServerBinding } from '@/api/types';
const desktop = { desktop_id: 'a', desktop_name: 'A', protocol_version: 2, min_client_protocol: 2, capabilities: ['agent_session'] };
const system = { storage_generation: 'a', agent_data_generation: 3, platform: 'win32', arch: 'x64' };
const binding: ServerBinding = { baseUrl: 'https://a.test', token: 'token-a', user: { user_id: 'u', username: 'U' }, desktop, system };
function harness(sameOrigin = false) {
  let persisted: ServerBinding | null = binding;
  return createConnectionStore({ read: async () => persisted, write: async next => { persisted = structuredClone(next); } }, sameOrigin);
}
test('saved credentials require target verification before business UI opens', async () => {
  const store = harness(); await store.hydrate();
  expect(store.getState()).toEqual({ phase: 'connected', epoch: 1, verified: false, binding });
  await store.verify(desktop, system, store.epoch());
  const state = store.getState(); expect(state.phase === 'connected' && state.verified).toBe(true);
});
test('late target verification cannot replace a newer Desktop', async () => {
  const store = harness(); await store.connect(binding); const oldEpoch = store.epoch();
  await store.connect({ ...binding, token: 'token-b', desktop: { ...desktop, desktop_id: 'b' } });
  expect(await store.verify(desktop, system, oldEpoch)).toBe(false);
  expect(store.binding()?.desktop?.desktop_id).toBe('b');
  store.markAuthExpired('token-a', oldEpoch); await new Promise(resolve => setTimeout(resolve, 0));
  expect(store.binding()?.token).toBe('token-b');
});
test('restored data creates a new epoch; routine token refresh preserves it', async () => {
  const store = harness(); await store.connect(binding); const epoch = store.epoch();
  await store.updateToken('next', 'token-a'); expect(store.epoch()).toBe(epoch);
  await store.verify(desktop, { ...system, storage_generation: 'restored' }, epoch);
  expect(store.epoch()).toBe(epoch + 1);
});
test('H5 ignores absolute saved addresses and prohibits path switching', async () => {
  const store = harness(true); await store.connect(binding);
  expect(store.binding()?.baseUrl).toBe('');
  expect(await store.selectRoute('https://other.test', 'relay', store.epoch())).toBe(false);
});
test('serialized login commits reject a second acceptance from the previous epoch', async () => {
  const store = harness(); const epoch = store.epoch();
  const first = store.connect(binding, false, epoch);
  const second = store.connect({ ...binding, token: 'b' }, false, epoch);
  expect(await first).toBe(true); expect(await second).toBe(false); expect(store.binding()?.token).toBe('token-a');
});
test('identity rejection closes the business generation and retains credentials only for repair', async () => {
  const store = harness(); await store.connect(binding); const epoch = store.epoch();
  expect(await store.block(epoch)).toBe(true); expect(store.epoch()).toBe(epoch + 1);
  const state = store.getState(); expect(state.phase === 'connected' && state.verified).toBe(false);
  expect(store.binding()?.token).toBe('token-a');
  await store.block(store.epoch()); expect(store.epoch()).toBe(epoch + 1);
});
test('an old logout cleanup cannot clear a newly paired Desktop', async () => {
  const store = harness(); await store.connect(binding); const epoch = store.epoch();
  await store.connect({ ...binding, token: 'b' });
  await store.disconnect(undefined, epoch); expect(store.binding()?.token).toBe('b');
  const current = store.epoch(); await store.updateToken('b-refreshed', 'b');
  await store.disconnect(undefined, current); expect(store.binding()).toBe(null);
});
