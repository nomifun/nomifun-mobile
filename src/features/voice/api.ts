import { api } from '@/api/client';
import { connectionStore } from '@/api/connection';
import type { Availability, Transport, VoiceActivation, VoiceBinding, VoiceModelChoice, VoiceProjection, VoiceState, WorkReceipt, Catalog, WorkSteeringPolicy } from './contracts';
import type { VoiceProfile, VoiceProfileProbeResult } from './contracts.generated';
import { flattenCatalog, profileProbe, profileUpdate } from './profile';
import type { MediaSocket, VoiceAPI } from './controller';

const root = '/api/mobile-voice/v1';
export const voiceCatalog = async (): Promise<{ models: VoiceModelChoice[] }> => {
  const catalog = await api<Catalog>(`${root}/catalog`);
  return { models: flattenCatalog(catalog) };
};
export const voiceCapabilities = () => api<{ supported: boolean; api_version: number; transports: Transport[] }>(`${root}/capabilities`);
export const voiceAvailability = (session: string, signal?: AbortSignal) => api<Availability>(`${root}/availability?agent_session_id=${encodeURIComponent(session)}`, { signal });
export function saveVoiceProfile(id: string, revision: number, session: string, bindingVersion: number, model: VoiceModelChoice, transport: Transport, config: Record<string, unknown>, role = 'default', workSteeringPolicy: WorkSteeringPolicy = 'safe_boundary') {
  return api<VoiceProfile>(`${root}/profiles/${encodeURIComponent(id)}`, { method: 'PUT', body: profileUpdate(revision, session, bindingVersion, model, transport, config, role, workSteeringPolicy) });
}
export async function probeVoiceProfile(profile: VoiceProfile, session: string, bindingVersion: number): Promise<VoiceProfileProbeResult> {
  const result = await api<VoiceProfileProbeResult>(`${root}/profiles/${encodeURIComponent(profile.profile_id)}/probe`,
    { timeoutMs: 30000, body: profileProbe(profile, session, bindingVersion) });
  if (result.profile_id !== profile.profile_id || result.profile_revision !== profile.revision || result.transport !== profile.route.transport) throw new Error('Voice probe profile identity changed');
  return result;
}
const sessionPath = (id: string) => `${root}/sessions/${encodeURIComponent(id)}`;
export const voiceAPI: VoiceAPI = {
  availability: voiceAvailability,
  activate: (binding, endpoint, offer, takeover) => api<VoiceActivation>(`${root}/sessions`, { timeoutMs: 30000, body: {
    agent_session_id: binding.agent_session_id, binding_version: binding.binding_version, profile_id: binding.profile_id,
    profile_revision: binding.profile_revision, endpoint_id: endpoint, transport: binding.transport, native_offer: offer, takeover,
  } }),
  control: (id, epoch, control, signal) => api<VoiceState>(`${sessionPath(id)}/control`, { timeoutMs: 10000, signal, body: { activation_epoch: epoch, control } }),
  attachment: (id, epoch, offer) => api<VoiceActivation>(`${sessionPath(id)}/attachment`, { timeoutMs: 30000, body: { activation_epoch: epoch, native_offer: offer } }),
  projection: (id, epoch, signal) => api<VoiceProjection>(`${sessionPath(id)}/projection?activation_epoch=${epoch}`, { signal, timeoutMs: 2000 }),
  confirmSourceContext: (id, confirmation, signal) => api<{ confirmed: boolean }>(`${sessionPath(id)}/source-context`, { signal, body: confirmation }),
  work: (id, epoch, request, operationKey) => api<WorkReceipt>(`${sessionPath(id)}/work`, { body: { activation_epoch: epoch, operation_key: operationKey, request } }),
};
/** Attachment is a short, owner-scoped capability. It is never put in a URL,
 * stored with the connection JWT or sent through the business /ws channel. */
export function mediaSocket(id: string, ticket: string): MediaSocket {
  const binding = connectionStore.binding(); if (!binding) throw new Error('Pair with a Desktop before starting voice');
  const origin = binding.baseUrl || globalThis.location?.origin; if (!origin) throw new Error('Voice server address is unavailable');
  const url = new URL(sessionPath(id) + '/media', origin); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return new WebSocket(url.toString(), ['nomifun.voice.v1', `nomifun.voice.ticket.${ticket}`]) as unknown as MediaSocket;
}
/** Public operation identity, never a credential. */
export const operationIdentity = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
