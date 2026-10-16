export function distribution(samples: number[]) {
  const sorted = samples.filter(Number.isFinite).sort((a, b) => a - b);
  const at = (percentile: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentile) - 1)] : null;
  return { samples: sorted.length, p50_ms: at(.5), p95_ms: at(.95) };
}
/** Device/controller observations only; zero samples remain null. This report
 * is never populated by fixtures in a production runtime. */
export class VoiceDiagnostics {
  readonly inputAckMs: number[] = [];
  readonly outputToReportedConsumptionMs: number[] = [];
  readonly localFlushInvocationMs: number[] = [];
  inputFrames = 0; playbackReceipts = 0;
  add(collection: number[], sample: number) { collection.push(sample); if (collection.length > 200) collection.shift(); }
  report() { return { schema: 'nomifun.mobile-voice-observations.v1', input_frames: this.inputFrames, playback_receipts: this.playbackReceipts,
    input_admission_ack: distribution(this.inputAckMs), output_to_reported_consumption: distribution(this.outputToReportedConsumptionMs),
    local_flush_invocation: distribution(this.localFlushInvocationMs),
    limitation: 'Clock/callback observations are not acoustic delay, word alignment, AEC quality, or device acceptance.' }; }
}
