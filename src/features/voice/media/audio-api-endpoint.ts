import type { AudioMetadata, MediaSpec, OutputSegment, Transport, VoiceNegotiation } from '../contracts';
import type { AudioApiBuffer, AudioApiContext, AudioApiGain, AudioApiQueue, AudioApiRecorder, AudioApiSdk } from './audio-api-sdk';
import { validateAudio } from './codec';
import { validateSpec, type DeviceSettings, type MediaCallbacks, type VoiceMediaEndpoint } from './types';
export type { AudioApiSdk } from './audio-api-sdk';

export interface AudioApiEnvironment {
  sdk(): AudioApiSdk;
  foreground(): boolean;
  onForegroundChange(listener: (foreground: boolean) => void): () => void;
  now(): number;
  pollMs?: number;
  closeTimeoutMs?: number;
}
interface OutputBlock {
  segment: OutputSegment;
  metadata: AudioMetadata;
  payload: ArrayBuffer;
  enqueued: number;
  id?: string;
  renderedAt?: number;
  enqueueTimeline?: number | null;
  renderTimeline?: number | null;
  last?: boolean;
}
class MediaBacklogError extends Error {}
/** SDK owns the audio device and DSP. This adapter owns product identity,
 * bounded admission and lifecycle intent, never an Agent or a native engine. */
export class AudioApiEndpoint implements VoiceMediaEndpoint {
  private static owner?: AudioApiEndpoint;
  private sdk?: AudioApiSdk;
  private recorder?: AudioApiRecorder;
  private context?: AudioApiContext;
  private queue?: AudioApiQueue;
  private gain?: AudioApiGain;
  private input?: MediaSpec;
  private output?: MediaSpec;
  private generation = 0;
  private captureEpoch = 0;
  private sequence = 0;
  private capturedSamples = 0;
  private startAttempted = false;
  private wantsCapture = false;
  private wantsOutput = false;
  private outputBlocked = true;
  private closed = false;
  private failed = false;
  private volumeValue = 1;
  private outputRevision = 0;
  private bufferedUs = 0;
  private blocks: OutputBlock[] = [];
  private consumption = new Map<string, number>();
  private inputTokens = new Map<number, { bufferId: string; duration: number; epoch: number; admitted: number }>();
  private pendingInputUs = 0;
  private subscriptions: Array<{ remove(): void }> = [];
  private leaveForeground?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private configuration?: Promise<DeviceSettings>;
  private captureGate: Promise<void> = Promise.resolve();
  private outputGate: Promise<void> = Promise.resolve();
  private closing?: Promise<void>;
  private earlyStop?: Promise<void>;

  constructor(private readonly callbacks: MediaCallbacks, private readonly env: AudioApiEnvironment) {}

  foreground(): boolean { return this.env.foreground(); }
  async prepare(transport: Transport): Promise<undefined> {
    if (transport !== 'relay') throw new Error('Native RTC is not supported in this build');
    if (this.closed || !this.foreground()) throw new Error('Voice requires an active foreground endpoint');
    this.sdk = this.env.sdk();
    if (await this.sdk.AudioManager.requestRecordingPermissions() !== 'Granted') throw new Error('Microphone permission denied');
    if (this.closed || !this.foreground()) throw new Error('Voice preparation cancelled');
    return;
  }

  configure(negotiation: VoiceNegotiation, generation: number): Promise<DeviceSettings> {
    if (this.configuration) throw new Error('Voice audio is already configured');
    const operation = this.configureDevice(negotiation, generation);
    this.configuration = operation;
    return operation;
  }
  private async configureDevice(negotiation: VoiceNegotiation, generation: number): Promise<DeviceSettings> {
    if (this.closed || !this.foreground()) throw new Error('Voice requires an active foreground endpoint');
    if (AudioApiEndpoint.owner && AudioApiEndpoint.owner !== this) throw new Error('Previous voice audio cleanup is unconfirmed');
    const { input_spec: input, output_spec: output } = negotiation;
    if (!input || !output || negotiation.native_attachment) throw new Error('Native relay requires negotiated PCM media');
    validateSpec(input); validateSpec(output);
    if (!Number.isSafeInteger(generation) || generation < 0) throw new Error('Invalid output generation');
    AudioApiEndpoint.owner = this;
    this.sdk ??= this.env.sdk(); this.input = input; this.output = output; this.generation = generation;
    try {
      const manager = this.sdk.AudioManager;
      if (await manager.checkRecordingPermissions() !== 'Granted') throw new Error('Microphone permission revoked');
      manager.activelyReclaimSession(false);
      manager.setAudioSessionOptions({ iosCategory: 'playAndRecord', iosMode: 'voiceChat',
        iosOptions: ['defaultToSpeaker', 'allowBluetoothHFP'], iosNotifyOthersOnDeactivation: true });
      await manager.setAudioSessionActivity(true);
      if (this.closed || !this.foreground()) throw new Error('Voice configuration cancelled');
      this.context = new this.sdk.AudioContext({ sampleRate: output.format.sample_rate, foregroundOnly: true });
      await this.context.suspend();
      this.makeQueue();
      this.subscriptions.push(manager.addSystemEventListener('interruption', event => {
        if (event.type === 'began') this.unavailable('device_unavailable');
      }));
      this.subscriptions.push(manager.addSystemEventListener('routeChange', event => {
        if (event.reason !== 'CategoryChange') this.unavailable('device_unavailable');
      }));
      manager.observeAudioInterruptions('gainTransientExclusive');
      this.leaveForeground = this.env.onForegroundChange(active => { if (!active) this.unavailable('device_unavailable'); });
      if (this.closed || !this.foreground()) throw new Error('Voice configuration cancelled');
      this.timer = setInterval(() => this.poll(), this.env.pollMs ?? 20);
      return { input_sample_rate: input.format.sample_rate, output_sample_rate: this.context.sampleRate };
    } catch (error) {
      // Resource fields were assigned before each await so the owner can also
      // release partially configured SDK resources. No run-id acknowledgement needed.
      await this.releaseDevice().catch(() => { this.failed = true; });
      if (this.failed) throw new Error('Audio resource cleanup is unconfirmed', { cause: error });
      throw error;
    }
  }
  private makeQueue(): void {
    if (!this.context) throw new Error('Audio context is unavailable');
    this.gain = this.context.createGain(); this.gain.gain.value = this.volumeValue;
    this.gain.connect(this.context.destination);
    const revision = this.outputRevision;
    const queue = this.context.createBufferQueueSource({ pitchCorrection: false });
    queue.onBufferEnded = event => {
      if (this.closed || revision !== this.outputRevision || queue !== this.queue) return;
      const block = this.blocks.find(item => item.id === event.bufferId);
      if (!block || block.metadata.output_generation !== this.generation) return;
      // A render callback is not a speaker acknowledgement. The later native
      // sink timestamp must pass this conservative context-time boundary.
      block.renderedAt = this.context!.currentTime;
      block.renderTimeline = this.context!.getOutputTimestamp().timelineId;
      block.last = event.isLastBufferInQueue;
      this.poll();
    };
    queue.connect(this.gain); queue.start(0, 0); this.queue = queue;
  }

  async startOutput(): Promise<void> {
    if (this.closed || !this.context || !this.foreground()) throw new Error('Voice audio is unavailable');
    this.wantsOutput = true; const revision = this.outputRevision;
    const context = this.context;
    this.outputGate = this.outputGate.then(async () => {
      if (this.closed || revision !== this.outputRevision || !this.foreground()) return;
      await context.resume();
      if (this.closed || revision !== this.outputRevision) return;
      this.outputBlocked = false; this.drainOutput();
    });
    await this.outputGate;
  }

  capture(enabled: boolean): Promise<void> {
    if (this.closed || !this.sdk || !this.input) return Promise.reject(new Error('Voice audio is unavailable'));
    this.wantsCapture = enabled; const epoch = ++this.captureEpoch;
    if (!enabled) this.recorder?.clearOnAudioReady();
    this.captureGate = this.captureGate.then(async () => {
      const previousRecorder = this.recorder;
      if (this.startAttempted) {
        const result = await previousRecorder!.stop();
        if (result.status !== 'success') throw new Error(result.message || 'Microphone shutdown is unconfirmed');
        this.startAttempted = false; this.inputTokens.clear(); this.pendingInputUs = 0;
      }
      previousRecorder?.clearOnAudioReady(); previousRecorder?.clearOnError(); this.recorder = undefined;
      if (!enabled || this.closed || epoch !== this.captureEpoch || !this.wantsCapture) return;
      if (!this.foreground()) throw new Error('Voice is foreground-only');
      // Each explicit unmute has a new capture owner. The SDK also fences
      // pending start intents, so a late start on the old one cannot reopen
      // hardware after its stop intent.
      const recorder = new this.sdk!.AudioRecorder({ foregroundOnly: true, voiceProcessing: true });
      this.recorder = recorder;
      recorder.onError(() => { if (this.recorder === recorder && epoch === this.captureEpoch) this.unavailable('device_unavailable'); });
      const spec = this.input!;
      const minFrames = Math.ceil(spec.min_frame_duration_us * spec.format.sample_rate / 1e6);
      const maxFrames = Math.min(Math.floor(spec.max_frame_duration_us * spec.format.sample_rate / 1e6),
        Math.floor(spec.max_frame_bytes / (spec.format.channels * 2)));
      const frames = Math.max(minFrames, Math.min(maxFrames, Math.round(spec.format.sample_rate / 50)));
      if (frames <= 0 || frames > maxFrames) throw new Error('Unsupported PCM frame specification');
      const result = recorder.onAudioReady({ sampleRate: spec.format.sample_rate, bufferLength: frames,
        channelCount: spec.format.channels, maxPendingDurationUs: Math.min(200_000, spec.max_buffer_duration_us),
        maxPendingAgeUs: spec.max_frame_age_us }, event => {
        if (this.closed || epoch !== this.captureEpoch || !this.wantsCapture || !this.foreground()) return;
        try { this.captureBuffer(event.buffer, event.numFrames, event.bufferId, epoch); }
        catch { this.unavailable('backlog'); }
      });
      if (result.status !== 'success') throw new Error(result.message || 'Microphone callback is unavailable');
      this.startAttempted = true;
      const started = await recorder.start();
      if (started.status !== 'success') throw new Error(started.message || 'Microphone start failed');
      if (this.closed || epoch !== this.captureEpoch || !this.wantsCapture || !this.foreground()) {
        const stopped = await recorder.stop();
        if (stopped.status !== 'success') throw new Error(stopped.message || 'Microphone shutdown is unconfirmed');
        this.startAttempted = false;
      }
    });
    return this.captureGate;
  }
  private captureBuffer(buffer: AudioApiBuffer, frames: number, bufferId: string | undefined, epoch: number): void {
    const spec = this.input!;
    if (!bufferId || !Number.isSafeInteger(frames) || frames <= 0 || frames !== buffer.length ||
      buffer.sampleRate !== spec.format.sample_rate || buffer.numberOfChannels !== spec.format.channels)
      throw new Error('SDK PCM buffer differs from the negotiated format');
    const payload = new ArrayBuffer(frames * spec.format.channels * 2); const view = new DataView(payload);
    let peak = 0;
    for (let channel = 0; channel < spec.format.channels; channel++) {
      const samples = buffer.getChannelData(channel);
      if (samples.length !== frames) throw new Error('Invalid SDK PCM channel');
      for (let frame = 0; frame < frames; frame++) {
        if (!Number.isFinite(samples[frame])) throw new Error('Invalid SDK PCM sample');
        const value = Math.max(-1, Math.min(1, samples[frame])); peak = Math.max(peak, Math.abs(value));
        view.setInt16((frame * spec.format.channels + channel) * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
      }
    }
    const metadata = { sequence: this.sequence++, timestamp: Math.floor(this.capturedSamples * spec.timebase / buffer.sampleRate),
      duration_us: Math.floor(frames * 1e6 / buffer.sampleRate), format: spec.format };
    validateAudio({ ...metadata, activation_epoch: 1, output_generation: this.generation }, payload, spec);
    this.checkInputAge();
    if (this.pendingInputUs + metadata.duration_us > Math.min(200_000, spec.max_buffer_duration_us) ||
      [...this.inputTokens.values()].some(token => token.bufferId === bufferId)) throw new Error('Voice input duration backlog');
    this.capturedSamples += frames;
    this.inputTokens.set(metadata.sequence, { bufferId, duration: metadata.duration_us, epoch, admitted: this.env.now() });
    this.pendingInputUs += metadata.duration_us;
    this.callbacks.capture(metadata, payload); this.callbacks.level(peak);
  }
  returnInputCredit(sequence: number, durationUs: number): void {
    const token = this.inputTokens.get(sequence); if (!token || this.closed) return;
    if (token.duration !== durationUs) { this.unavailable('backlog'); return; }
    this.inputTokens.delete(sequence); this.pendingInputUs -= token.duration;
    if (token.epoch === this.captureEpoch) this.recorder?.acknowledgeBuffer(token.bufferId);
  }
  private checkInputAge(): void {
    if (!this.input) return;
    for (const token of this.inputTokens.values()) {
      if ((this.env.now() - token.admitted) * 1000 > this.input.max_frame_age_us) throw new Error('Voice input age backlog');
    }
  }

  play(segment: OutputSegment, metadata: AudioMetadata, payload: ArrayBuffer): void {
    if (this.closed || this.failed || metadata.output_generation !== this.generation) return;
    if (!this.output || !this.foreground()) { this.unavailable('device_unavailable'); return; }
    try {
      validateAudio(metadata, payload, this.output);
      if (this.bufferedUs + metadata.duration_us > this.output.max_buffer_duration_us) throw new Error('Voice playback duration backlog');
      this.blocks.push({ segment, metadata, payload, enqueued: this.env.now() }); this.bufferedUs += metadata.duration_us;
      this.drainOutput();
    } catch { this.unavailable('backlog'); }
  }
  private drainOutput(): void {
    if (this.outputBlocked || this.closed || !this.context || !this.queue) return;
    for (const block of this.blocks) {
      if (block.id) continue;
      if ((this.env.now() - block.enqueued) * 1000 > this.output!.max_frame_age_us)
        throw new MediaBacklogError('Voice playback age backlog');
      const { sample_rate: rate, channels } = block.metadata.format;
      const frames = block.payload.byteLength / (channels * 2);
      const buffer = this.context.createBuffer(channels, frames, rate); const view = new DataView(block.payload);
      for (let channel = 0; channel < channels; channel++) {
        const samples = new Float32Array(frames);
        for (let frame = 0; frame < frames; frame++) samples[frame] = view.getInt16((frame * channels + channel) * 2, true) / 32768;
        buffer.copyToChannel(samples, channel);
      }
      block.enqueueTimeline = this.context.getOutputTimestamp().timelineId;
      block.id = this.queue.enqueueBuffer(buffer);
    }
  }
  private poll(): void {
    if (this.closed || this.failed || !this.output || !this.context) return;
    try {
      if (!this.foreground()) { this.unavailable('device_unavailable'); return; }
      this.checkInputAge();
      const timestamp = this.context.getOutputTimestamp();
      const consumed: OutputBlock[] = [];
      const discontinuous: OutputBlock[] = [];
      for (const block of this.blocks) {
        if (block.renderedAt !== undefined && timestamp.timelineId !== null && block.renderTimeline !== timestamp.timelineId)
          discontinuous.push(block);
        else if (block.renderedAt !== undefined && timestamp.contextTime !== null && timestamp.precision !== 'unknown' &&
          Number.isFinite(timestamp.contextTime) && timestamp.contextTime >= block.renderedAt) {
          if (block.enqueueTimeline !== null && block.enqueueTimeline === block.renderTimeline) consumed.push(block);
          else discontinuous.push(block);
        }
        else if ((this.env.now() - block.enqueued) * 1000 > this.output.max_frame_age_us) throw new Error('Voice playback age backlog');
      }
      // A driver reconfiguration can discard a rendered but unplayed tail.
      // Retire its charged graph buffers without inventing speaker receipts.
      for (const block of discontinuous) {
        this.blocks.splice(this.blocks.indexOf(block), 1); this.bufferedUs -= block.metadata.duration_us;
      }
      for (const block of consumed) {
        this.blocks.splice(this.blocks.indexOf(block), 1); this.bufferedUs -= block.metadata.duration_us;
        const key = `${this.generation}:${block.segment.segment_id}:${block.segment.revision}`;
        const total = (this.consumption.get(key) ?? 0) + block.metadata.duration_us;
        this.consumption.set(key, total);
        if (this.consumption.size > 256) this.consumption.delete(this.consumption.keys().next().value!);
        this.callbacks.playback({ segment_id: block.segment.segment_id, revision: block.segment.revision,
          output_generation: this.generation, consumed_us: total, precision: 'estimated',
          uncertain_tail_us: Math.min(total, Math.max(block.metadata.duration_us, Math.ceil((timestamp.latency ?? 0) * 1e6))),
          finished: Boolean(block.last) && !this.blocks.some(item => item.segment.segment_id === block.segment.segment_id) });
      }
    } catch { this.unavailable('backlog'); }
  }

  flush(generation: number): void {
    if (this.closed || generation < this.generation) return;
    this.poll(); if (this.closed) return;
    this.generation = generation; const revision = ++this.outputRevision;
    this.outputBlocked = true; this.blocks = []; this.bufferedUs = 0; this.consumption.clear();
    const context = this.context, queue = this.queue, gain = this.gain;
    if (!context || !queue) return;
    if (gain) gain.gain.value = 0;
    queue.onBufferEnded = null; queue.stop(0); queue.clearBuffers();
    this.outputGate = this.outputGate.then(async () => {
      await context.suspend();
      if (this.closed || revision !== this.outputRevision) return;
      queue.disconnect(); gain?.disconnect(); this.makeQueue();
      if (this.wantsOutput && this.foreground()) {
        await context.resume();
        if (this.closed || revision !== this.outputRevision) return;
        this.outputBlocked = false; this.drainOutput();
      }
    });
    void this.outputGate.catch(error => this.unavailable(error instanceof MediaBacklogError ? 'backlog' : 'device_unavailable'));
  }
  volume(value: number): void {
    this.volumeValue = Math.max(0, Math.min(1, value));
    if (this.gain && !this.outputBlocked) this.gain.gain.value = this.volumeValue;
  }
  async resumeNativeBoundary(): Promise<void> { throw new Error('Native RTC is not supported in this build'); }
  private unavailable(reason: string): void {
    if (this.closed || this.failed) return;
    this.failed = true; this.wantsCapture = false; ++this.captureEpoch;
    this.recorder?.clearOnAudioReady(); this.queue?.stop(0); this.queue?.clearBuffers();
    if (this.gain) this.gain.gain.value = 0;
    void this.close().catch(() => {}); this.callbacks.unavailable(reason);
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; this.wantsCapture = false; this.wantsOutput = false; ++this.captureEpoch; ++this.outputRevision;
    this.recorder?.clearOnAudioReady(); this.queue?.stop(0); this.queue?.clearBuffers();
    if (this.gain) this.gain.gain.value = 0;
    // Send the SDK stop intent before waiting for a pending start ACK. The
    // start continuation checks the invalidated epoch and stops again after
    // settlement; neither path can publish audio into the retired endpoint.
    if (this.startAttempted && this.recorder) {
      this.earlyStop = this.recorder.stop().then(result => {
        if (result.status !== 'success') throw new Error(result.message || 'Microphone stop intent is unconfirmed');
      });
      void this.earlyStop.catch(() => {});
    }
    const outputStop = this.context?.suspend();
    void outputStop?.catch(() => {});
    const completion = (async () => {
      await this.configuration?.catch(() => {});
      await Promise.allSettled([this.captureGate, this.outputGate, this.earlyStop, outputStop]);
      await this.releaseDevice();
    })();
    // A pending SDK shutdown is not successful cleanup. Keep its owner fence
    // until actual completion even if the caller receives a bounded timeout.
    this.closing = new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Audio resource cleanup is unconfirmed')),
        this.env.closeTimeoutMs ?? 1000);
      completion.then(() => { clearTimeout(deadline); resolve(); }, error => { clearTimeout(deadline); reject(error); });
    });
    return this.closing;
  }
  private async releaseDevice(): Promise<void> {
    clearInterval(this.timer); this.timer = undefined; this.leaveForeground?.(); this.leaveForeground = undefined;
    for (const sub of this.subscriptions.splice(0)) sub.remove();
    this.recorder?.clearOnAudioReady(); this.recorder?.clearOnError();
    const failures: unknown[] = [];
    if (this.startAttempted) {
      try {
        const result = await this.recorder!.stop();
        if (result.status !== 'success') throw new Error(result.message || 'Microphone shutdown is unconfirmed');
        this.startAttempted = false;
      } catch (error) { failures.push(error); }
    }
    this.queue && (this.queue.onBufferEnded = null); this.queue?.stop(0); this.queue?.clearBuffers();
    try { await this.context?.close(); } catch (error) { failures.push(error); }
    if (this.sdk && AudioApiEndpoint.owner === this) {
      try {
        this.sdk.AudioManager.observeAudioInterruptions(false);
        await this.sdk.AudioManager.setAudioSessionActivity(false);
      } catch (error) { failures.push(error); }
      if (failures.length === 0) AudioApiEndpoint.owner = undefined;
    }
    if (failures.length) throw new AggregateError(failures, 'Audio resource cleanup is unconfirmed');
    this.context = undefined; this.recorder = undefined; this.queue = undefined; this.gain = undefined;
    this.blocks = []; this.inputTokens.clear(); this.pendingInputUs = 0; this.bufferedUs = 0;
  }
}
