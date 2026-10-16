import type { Availability, Catalog, Transport, VoiceBinding, VoiceModelChoice, WorkSteeringPolicy } from './contracts';
import type { VoiceProfile, VoiceProfileProbeRequest, VoiceProfileUpdate } from './contracts.generated';
export function flattenCatalog(catalog: Catalog): VoiceModelChoice[] {
  return catalog.models.flatMap(model => model.adapters.map(adapter => ({ ...model, adapter_id: adapter.adapter_id, full_duplex: adapter.support,
    transports: adapter.descriptor.transports, descriptor: adapter.descriptor, config_schema: adapter.config_schema,
    evidence: [...new Set(Object.values(adapter.descriptor.capabilities).map(value => value?.source).filter((value): value is string => Boolean(value)))].join(' · '),
  })));
}
/** A saved transport is an immutable activation fact. An endpoint cannot select
 * a different transport from a capability list as a silent fallback. */
export function bindingFromAvailability(value: Availability, transports: Transport[], session: string, label: string): VoiceBinding {
  const profile = value.profile;
  if (!value.enabled || !profile?.enabled || profile.agent_session_id !== session || profile.binding_version !== value.binding_version) throw new Error('Voice profile is disabled or stale');
  if (!value.transport || value.transport !== profile.route.transport || !transports.includes(value.transport)) throw new Error('Saved voice transport is unsupported on this endpoint');
  return { agent_session_id: session, binding_version: value.binding_version, profile_id: profile.profile_id, profile_revision: profile.revision,
    label: value.label || label, transport: value.transport, native_requirements: value.native_requirements };
}
export function profileUpdate(revision: number, session: string, bindingVersion: number, model: VoiceModelChoice, transport: Transport,
  config: Record<string, unknown>, role: string, workSteeringPolicy: WorkSteeringPolicy = 'safe_boundary'): VoiceProfileUpdate {
  if (model.full_duplex !== 'supported' || !model.transports.includes(transport) || !model.connection_roles.includes(role)) throw new Error('Voice capability or connection role is unverified');
  return { expected_revision: revision, agent_session_id: session, binding_version: bindingVersion, enabled: true,
    provider_id: model.provider_id, model: model.model, adapter_id: model.adapter_id, connection_role: role, transport, adapter_config: config,
    work_steering_policy: workSteeringPolicy };
}
/** Probe has no media endpoint and cannot manufacture an RTC offer or silently
 * change a saved transport. It checks the exact saved Relay profile only. */
export function profileProbe(profile: VoiceProfile, session: string, bindingVersion: number): VoiceProfileProbeRequest {
  if (!profile.enabled || profile.agent_session_id !== session || profile.binding_version !== bindingVersion) throw new Error('Voice profile is disabled or stale');
  if (profile.route.transport !== 'relay') throw new Error('This connection probe requires a saved Relay profile');
  return { agent_session_id: session, binding_version: bindingVersion, profile_revision: profile.revision };
}
