import type { AudioMetadata, MediaSpec, OutputSegment, VoiceNegotiation, Transport } from '../contracts';
export interface PlaybackCursor { segment_id: string; revision: number; output_generation: number; consumed_us: number;
  uncertain_tail_us: number; precision: 'estimated' | 'unknown'; finished: boolean }
export interface DeviceSettings { device_id?: string; input_sample_rate?: number; output_sample_rate?: number; echo_cancellation?: boolean }
export interface MediaCallbacks { capture: (metadata: Omit<AudioMetadata, 'activation_epoch' | 'output_generation'>, payload: ArrayBuffer) => void;
  playback: (cursor: PlaybackCursor) => void; unavailable: (reason: string) => void; level: (level: number) => void }
/** Both native and H5 are real device ports. Preparation never streams before attachment. */
export interface VoiceMediaEndpoint {
  prepare(transport: Transport, requirements?: { data_channel_label?: string | null }): Promise<string | undefined>;
  configure(negotiation: VoiceNegotiation, generation: number): Promise<DeviceSettings>;
  startOutput?(): Promise<void>;
  /** Server disposition returns the bounded local media credit. It does not
   * assert that a model or person heard the audio. */
  returnInputCredit?(sequence: number, durationUs: number): void;
  foreground?(): boolean;
  capture(enabled: boolean): Promise<void>;
  play(segment: OutputSegment, metadata: AudioMetadata, payload: ArrayBuffer): void;
  flush(generation: number): void;
  resumeNativeBoundary(attachmentId: string): Promise<void>;
  volume(value: number): void;
  close(): Promise<void>;
}
export interface EndpointFactory { transports: Transport[]; create(callbacks: MediaCallbacks): VoiceMediaEndpoint }
export function validateSpec(spec: MediaSpec): void {
  if (spec.format.encoding !== 'pcm' || spec.format.sample_format !== 'signed16_le' || spec.format.sample_rate < 8000 ||
    spec.format.sample_rate > 96000 || ![1, 2].includes(spec.format.channels) || spec.min_frame_duration_us <= 0 ||
    spec.max_frame_duration_us < spec.min_frame_duration_us || spec.max_buffer_duration_us <= 0 || spec.max_frame_age_us <= 0) throw new Error('Unsupported media specification');
}
