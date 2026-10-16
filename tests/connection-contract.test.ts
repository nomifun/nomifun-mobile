import { expect, test } from 'bun:test';
import { assertDesktopIdentity, connectionNamespace, isLocalConnectionAddress, requireSecureConnectionAddress, validateDesktopInfo, validateSystemInfo } from '@/api/connection-contract';

const desktop = { desktop_id: 'desktop-a', desktop_name: 'Computer A', protocol_version: 1, min_client_protocol: 1, capabilities: ['agent_session', 'realtime', 'device_pairing'] };
const system = { storage_generation: 'generation-a', agent_data_generation: 3, platform: 'win32', arch: 'x64' };

test('compatibility and canonical data identity fail closed', () => {
  expect(validateDesktopInfo(desktop)).toEqual(desktop);
  expect(validateSystemInfo(system)).toEqual(system);
  expect(() => validateDesktopInfo({ ...desktop, min_client_protocol: 2 })).toThrow();
  expect(() => validateDesktopInfo({ ...desktop, desktop_id: '' })).toThrow();
  expect(() => validateSystemInfo({ ...system, storage_generation: 'uninitialized' })).toThrow();
  expect(() => assertDesktopIdentity(desktop, { ...desktop, desktop_id: 'desktop-b' })).toThrow();
});
test('namespace changes with Desktop, data generation and authenticated owner', () => {
  const binding = { baseUrl: 'https://a.test', token: 'token', user: { user_id: 'user', username: 'u' }, desktop, system };
  const key = connectionNamespace(binding);
  expect(connectionNamespace({ ...binding, token: 'rotated' })).toBe(key);
  expect(connectionNamespace({ ...binding, system: { ...system, storage_generation: 'restored' } }) === key).toBe(false);
  expect(connectionNamespace({ ...binding, user: { user_id: 'other', username: 'u' } }) === key).toBe(false);
});
test('only real LAN addresses permit HTTP; public DNS prefixes cannot masquerade as IPv6', () => {
  for (const host of ['localhost', '127.0.0.1', '192.168.1.5', '10.0.0.2', '172.16.0.1', '[::1]', '[fc00::1]', '[fdab::1]', '[fe80::1]', '[febf::1]']) {
    expect(isLocalConnectionAddress(`http://${host}`)).toBe(true);
  }
  for (const host of ['fcorp.example', 'fdexample.com', 'fe80.example', 'fc.test', '[fc::1]', '[fd::1]', '[fe00::1]', '[fec0::1]', '172.32.0.1', '8.8.8.8', '192.168.1.5.example.com']) {
    expect(isLocalConnectionAddress(`http://${host}`)).toBe(false);
    expect(() => requireSecureConnectionAddress(`http://${host}`)).toThrow();
    requireSecureConnectionAddress(`https://${host}`);
  }
});
