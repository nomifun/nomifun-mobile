/** The voice port uses SDK device primitives only; it owns no native engine. */
export interface AudioApiResult { status: 'success' | 'error'; message?: string }
export interface AudioApiBuffer {
  readonly length: number;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
  copyToChannel(source: Float32Array, channel: number): void;
}
export interface AudioApiQueue {
  enqueueBuffer(buffer: AudioApiBuffer): string;
  clearBuffers(): void;
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
  disconnect(): void;
  connect(destination: unknown): unknown;
  onBufferEnded: ((event: { bufferId: string; isLastBufferInQueue: boolean }) => void) | null | undefined;
}
export interface AudioApiGain {
  gain: { value: number };
  connect(destination: unknown): unknown;
  disconnect(): void;
}
export interface AudioApiOutputTimestamp {
  timelineId: number | null;
  contextTime: number | null;
  performanceTime: number | null;
  latency: number | null;
  precision: 'estimated' | 'unknown';
}
export interface AudioApiContext {
  readonly sampleRate: number;
  readonly currentTime: number;
  readonly destination: unknown;
  readonly state: 'running' | 'suspended' | 'closed';
  createGain(): AudioApiGain;
  createBuffer(channels: number, frames: number, rate: number): AudioApiBuffer;
  createBufferQueueSource(options?: { pitchCorrection?: boolean }): AudioApiQueue;
  getOutputTimestamp(): AudioApiOutputTimestamp;
  suspend(): Promise<void>;
  resume(): Promise<void>;
  close(): Promise<void>;
}
export interface AudioApiRecorder {
  onAudioReady(options: { sampleRate: number; bufferLength: number; channelCount: number;
    maxPendingDurationUs: number; maxPendingAgeUs: number },
  callback: (event: { buffer: AudioApiBuffer; numFrames: number; when: number; bufferId?: string }) => void): AudioApiResult;
  clearOnAudioReady(): void;
  onError(callback: (event: { message: string }) => void): void;
  clearOnError(): void;
  start(): Promise<AudioApiResult>;
  stop(): Promise<AudioApiResult>;
  acknowledgeBuffer(bufferId: string): void;
}
export interface AudioApiManager {
  requestRecordingPermissions(): Promise<'Granted' | 'Denied' | 'Undetermined'>;
  checkRecordingPermissions(): Promise<'Granted' | 'Denied' | 'Undetermined'>;
  setAudioSessionOptions(options: { iosCategory: 'playAndRecord'; iosMode: 'voiceChat';
    iosOptions: ('defaultToSpeaker' | 'allowBluetoothHFP')[]; iosNotifyOthersOnDeactivation: boolean }): void;
  setAudioSessionActivity(active: boolean): Promise<void>;
  observeAudioInterruptions(type: 'gainTransientExclusive' | false): void;
  activelyReclaimSession(enabled: boolean): void;
  addSystemEventListener(name: 'interruption' | 'routeChange', callback: (event: {
    type?: 'began' | 'ended'; reason?: string }) => void): { remove(): void };
}
export interface AudioApiSdk {
  AudioContext: new(options: { sampleRate: number; foregroundOnly: true }) => AudioApiContext;
  AudioRecorder: new(options: { foregroundOnly: true; voiceProcessing: true }) => AudioApiRecorder;
  AudioManager: AudioApiManager;
}
