export class PcmCaptureEncoder {
  constructor(inputRate: number, outputRate: number, channels: number, frameDurationUs: number);
  push(inputChannels: Float32Array[]): Array<{ payload: ArrayBuffer; sequence: number; start_sample: number; frame_samples: number }>;
  clear(): void;
}
export function resamplePcm16(payload: ArrayBuffer, inputRate: number, inputChannels: number, outputRate: number, outputChannels: number): Float32Array;
export class PcmPlaybackQueue {
  constructor(outputRate: number, outputChannels: number, maxBufferUs: number, maxAgeUs: number);
  push(metadata: { segment_id: string; revision: number; output_generation: number; duration_us: number; format: { sample_rate: number; channels: number } }, payload: ArrayBuffer, nowUs: number): boolean;
  flush(generation: number): void;
  revoke(segmentId: string, revision: number, generation: number): void;
  render(outputs: Float32Array[], nowUs: number): { reports: Array<{ segment_id: string; revision: number; output_generation: number; sequence?: number; consumed_us: number; consumed_before_us: number; render_start_us: number; render_end_us: number; block_done: boolean }>; buffered_us: number; underflow: boolean };
}
export class PcmCaptureBudget {
  constructor(maxDurationUs: number, maxAgeUs: number);
  readonly usedUs: number; readonly epoch: number; readonly active: boolean; readonly expired: boolean;
  begin(epoch: number): void; end(): void;
  check(nowUs: number): boolean; admit(durationUs: number, nowUs: number): boolean;
  issue(sequence: number, durationUs: number, nowUs: number): { captureEpoch: number; admittedUs: number } | undefined;
  acknowledge(epoch: number, sequence: number, durationUs: number, nowUs: number): boolean;
}
