/** Independently generated product contracts; never import Desktop UI DTOs. */
import type * as Canonical from './contracts.generated';
export type Transport = Canonical.VoiceTransportPreference;
export type CapabilitySupport = Canonical.CapabilitySupport;
export type AudioFormat = Canonical.AudioFormat;
export type MediaSpec = Canonical.MediaSpec;
export type AudioFrame = Canonical.AudioFrame;
export interface AudioMetadata extends Omit<AudioFrame, 'payload'> { segment_id?: string }
export type VoiceState = Canonical.VoiceState;
export type VoiceNegotiation = Canonical.VoiceNegotiation;
export type VoiceActivation = Canonical.VoiceActivationResponse;
export type OutputSegment = Canonical.OutputSegment;
export type PlaybackReceipt = Canonical.PlaybackReceipt;
export type WorkTarget = Canonical.WorkTarget;
export type WorkReceipt = Canonical.VoiceWorkReceipt;
export type WorkRequest = Canonical.VoiceWorkRequest;
export type WorkSteeringPolicy = Canonical.WorkSteeringPolicy;
export type TranscriptFragment = Canonical.TranscriptFragment;
export type ApprovalPresentation = Canonical.VoiceApprovalPresentation;
export type SourceContextRequirement = Canonical.VoiceSourceContextRequirement;
export type SourceContextConfirmation = Canonical.VoiceSourceContextConfirmation;
export type VoiceControl = Extract<Canonical.VoiceControl, { kind: 'mute_input' | 'interrupt_output' | 'playback' | 'close' }>;
export type ModelEvent = Canonical.VoiceModelEvent;
export type ProductEvent = Canonical.VoiceProductEvent;
export interface VoiceBinding { agent_session_id: string; binding_version: number; profile_id: string; profile_revision: number;
  label: string; transport: Transport; native_requirements?: Canonical.VoiceNativeRequirements | null }
export interface Availability { enabled: boolean; binding_version: number; profile?: Canonical.VoiceProfile | null; transport?: Transport;
  label?: string; native_requirements?: Canonical.VoiceNativeRequirements | null;
  active_voice?: { voice_session_id: string; activation_epoch: number; state: VoiceState } }
export interface ConfigSchema { properties?: Record<string, { type?: string; title?: string; enum?: string[]; default?: unknown }> }
export interface VoiceModelChoice { provider_id: string; model: string; label: string; adapter_id: string; full_duplex: CapabilitySupport;
  evidence: string; transports: Transport[]; connection_roles: string[]; descriptor: Canonical.VoiceAdapterDescriptor; config_schema: ConfigSchema }
export interface Catalog { models: Array<{ provider_id: string; model: string; label: string; connection_roles: string[];
  adapters: Array<{ adapter_id: string; support: CapabilitySupport; descriptor: Canonical.VoiceAdapterDescriptor; config_schema: ConfigSchema }> }> }
export interface VoiceProjection { state: VoiceState; transcripts: TranscriptFragment[]; playback_receipts: PlaybackReceipt[];
  last_work_receipt?: WorkReceipt | null; approvals: ApprovalPresentation[]; source_context_requirement: SourceContextRequirement | null }
