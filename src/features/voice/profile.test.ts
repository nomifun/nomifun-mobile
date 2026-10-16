import { expect, test } from 'bun:test';
import { bindingFromAvailability, flattenCatalog, profileProbe, profileUpdate } from './profile';
import type { Availability, Catalog } from './contracts';
const descriptor = { adapter_id: 'neutral.adapter', contract_version: 1, api_version: 'v1', config_schema_version: 1, label: 'Duplex',
  capabilities: { continuous_input: { support: 'supported' as const, source: 'Official continuous input evidence' } }, transports: ['relay' as const, 'native_webrtc' as const], input_specs: [], output_specs: [] };
const catalog: Catalog = { models: [{ provider_id: 'voice-provider', model: 'duplex', label: 'Independent voice model', connection_roles: ['default', 'voice'],
  adapters: [{ adapter_id: descriptor.adapter_id, support: 'supported', descriptor, config_schema: { properties: {} } }] }] };
function availability(): Availability { return { enabled: true, binding_version: 5, transport: 'native_webrtc', profile: {
  profile_id: 'profile', revision: 3, agent_session_id: 'session', binding_version: 5, enabled: true, label: 'Voice model', work_steering_policy: 'safe_boundary', route: {
    schema: 'nomifun.voice-route-record.v1', route_id: 'route', revision: 1, provider_id: 'voice-provider', model: 'duplex', model_revision: 1,
    connection_config_ref: 'owned-opaque-ref', credential_ref: 'host-only-lease-reference', adapter_id: descriptor.adapter_id, adapter_contract_version: 1,
    adapter_config: {}, adapter_config_digest: 'a'.repeat(64), connection_config_digest: 'b'.repeat(64), required_features: ['continuous_input'], transport: 'native_webrtc',
  } } }; }
test('nested registration metadata is projected once, retaining adapter and connection-role identity', () => {
  const rows = flattenCatalog(catalog); expect(rows.length).toBe(1); expect(rows[0].adapter_id).toBe(descriptor.adapter_id);
  expect(rows[0].connection_roles).toEqual(['default', 'voice']); expect(rows[0].evidence).toContain('Official continuous input evidence');
});
test('saved RTC is never silently downgraded to a native relay endpoint', () => {
  expect(() => bindingFromAvailability(availability(), ['relay'], 'session', 'Original work')).toThrow();
  expect(bindingFromAvailability(availability(), ['relay', 'native_webrtc'], 'session', 'Original work').transport).toBe('native_webrtc');
});
test('stale or disabled profile cannot bind a new current session identity', () => {
  const stale = availability(); stale.binding_version = 6;
  expect(() => bindingFromAvailability(stale, ['native_webrtc'], 'session', 'Label')).toThrow();
  const disabled = availability(); disabled.profile!.enabled = false;
  expect(() => bindingFromAvailability(disabled, ['native_webrtc'], 'session', 'Label')).toThrow();
  expect(() => bindingFromAvailability(availability(), ['native_webrtc'], 'other-session', 'Label')).toThrow();
});
test('profile writes are isolated opt-in facts without work-model or permission mutations', () => {
  const model = flattenCatalog(catalog)[0]; const body = profileUpdate(3, 'session', 5, model, 'relay', { voice: 'selected' }, 'voice');
  expect(body.adapter_id).toBe(descriptor.adapter_id); expect(body.connection_role).toBe('voice'); expect(body.enabled).toBe(true);
  expect(body.work_steering_policy).toBe('safe_boundary');
  expect(body).not.toHaveProperty('agent_binding'); expect(body).not.toHaveProperty('work_model'); expect(body).not.toHaveProperty('permissions');
  expect(() => profileUpdate(3, 'session', 5, { ...model, full_duplex: 'unknown' }, 'relay', {}, 'voice')).toThrow();
});
test('immediate model correction is an explicit independent profile choice, never the default', () => {
  const model = flattenCatalog(catalog)[0];
  const defaults = profileUpdate(3, 'session', 5, model, 'relay', {}, 'default');
  const optedIn = profileUpdate(3, 'session', 5, model, 'relay', {}, 'default', 'supersede_model_step');
  expect(defaults.work_steering_policy).toBe('safe_boundary'); expect(optedIn.work_steering_policy).toBe('supersede_model_step');
  expect({ ...optedIn, work_steering_policy: defaults.work_steering_policy }).toEqual(defaults);
  expect(optedIn).not.toHaveProperty('text_steering_policy'); expect(optedIn).not.toHaveProperty('permissions');
});
test('a connection probe uses only an enabled saved Relay profile and exact observed identity', () => {
  const profile = availability().profile!;
  expect(() => profileProbe(profile, 'session', 5)).toThrow();
  profile.route.transport = 'relay';
  expect(profileProbe(profile, 'session', 5)).toEqual({ agent_session_id: 'session', binding_version: 5, profile_revision: 3 });
  expect(() => profileProbe(profile, 'other-session', 5)).toThrow(); expect(() => profileProbe(profile, 'session', 6)).toThrow();
  profile.enabled = false; expect(() => profileProbe(profile, 'session', 5)).toThrow();
});
