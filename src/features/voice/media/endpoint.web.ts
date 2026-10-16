import type { AudioMetadata, MediaSpec, OutputSegment, Transport, VoiceNegotiation } from '../contracts';
import { validateSpec, type DeviceSettings, type EndpointFactory, type MediaCallbacks, type VoiceMediaEndpoint } from './types';
import { validateAudio } from './codec';

/** Browser device implementation; no vendor messages are exchanged here. */
class WebEndpoint implements VoiceMediaEndpoint {
  private static owner?: WebEndpoint;
  private stream?: MediaStream; private device?: string; private transport?: Transport;
  private captureContext?: AudioContext; private playbackContext?: AudioContext;
  private captureNode?: AudioWorkletNode; private playbackNode?: AudioWorkletNode; private source?: MediaStreamAudioSourceNode; private gain?: GainNode;
  private peer?: RTCPeerConnection; private sender?: RTCRtpSender; private channel?: RTCDataChannel; private sink?: HTMLAudioElement; private remote?: MediaStream;
  private closed = false; private paused = true; private generation = 0; private captureEpoch = 0; private detached = false;
  private started = false;
  private inputSpec?: MediaSpec; private outputSpec?: MediaSpec;
  private inputCredits = new Map<number, { epoch: number; duration: number }>();
  private outputCredits = new Map<number, { duration: number; enqueued: number }>();
  private outputUs = 0; private outputBlocked = false; private pendingOutput: Array<{ metadata: AudioMetadata & { revision: number }; payload: ArrayBuffer }> = [];
  private outputClock?: ReturnType<typeof setInterval>; private closing?: Promise<void>;
  private preparing?: Promise<string | undefined>; private localVolume = 1;
  private rendered = new Map<string, { segment: string; revision: number; generation: number; consumed: number;
    end: number; done: boolean; unknown: boolean; finished?: boolean; portions: Array<{ start: number; end: number; before: number; after: number; observed: number }> }>();
  foreground(): boolean { return typeof document === 'undefined' || document.visibilityState === 'visible'; }
  private visibility = () => { if (!this.foreground()) this.unavailable('device_unavailable'); };
  private unavailable(reason: string): void {
    if (this.closed) return;
    this.paused = true; void this.close().catch(() => {}); this.callbacks.unavailable(reason);
  }
  private trackEnded = () => this.callbacks.unavailable('device_unavailable');
  private cancelNegotiation?: () => void;
  private remoteReady?: () => void;
  private permission?: PermissionStatus;
  private devices = '';
  private denied = () => { if (this.permission?.state === 'denied') this.callbacks.unavailable('permission_revoked'); };
  private changed = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    if (this.closed) return;
    const identity = devices.filter(device => device.kind === 'audioinput' || device.kind === 'audiooutput').map(device => `${device.kind}:${device.deviceId}`).sort().join('|');
    if (identity !== this.devices || (this.device && this.stream?.getAudioTracks()[0]?.getSettings().deviceId !== this.device)) this.callbacks.unavailable('device_unavailable');
  };
  constructor(private readonly callbacks: MediaCallbacks) {}
  prepare(transport: Transport, requirements?: { data_channel_label?: string | null }): Promise<string | undefined> {
    if (this.preparing) return this.preparing;
    if (WebEndpoint.owner && WebEndpoint.owner !== this) return Promise.reject(new Error('Previous voice audio cleanup is unconfirmed'));
    WebEndpoint.owner = this; this.preparing = this.prepareDevice(transport, requirements); return this.preparing;
  }
  private async prepareDevice(transport: Transport, requirements?: { data_channel_label?: string | null }): Promise<string | undefined> {
    if (this.closed || !this.foreground()) throw new Error('Voice requires an active foreground endpoint');
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Microphone requires a secure connection');
    this.transport = transport;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (this.closed || !this.foreground()) { this.stream.getTracks().forEach(track => track.stop()); throw new Error('Voice preparation cancelled'); }
    for (const track of this.stream.getTracks()) track.enabled = false;
    document.addEventListener('visibilitychange', this.visibility);
    this.device = this.stream.getAudioTracks()[0]?.getSettings().deviceId;
    this.devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audioinput' || device.kind === 'audiooutput')
      .map(device => `${device.kind}:${device.deviceId}`).sort().join('|');
    if (this.closed) throw new Error('Voice preparation cancelled');
    navigator.mediaDevices.addEventListener('devicechange', this.changed);
    for (const track of this.stream.getTracks()) { track.enabled = false; track.addEventListener('ended', this.trackEnded); }
    void navigator.permissions?.query({ name: 'microphone' as PermissionName }).then(permission => {
      if (this.closed) return; this.permission = permission; permission.addEventListener('change', this.denied);
    }).catch(() => undefined);
    if (transport === 'relay') {
      this.captureContext = new AudioContext(); this.playbackContext = new AudioContext();
      this.captureContext.onstatechange = () => { if (this.started && !this.closed && !this.paused && this.captureContext?.state !== 'running') this.callbacks.unavailable('device_unavailable'); };
      this.playbackContext.onstatechange = () => { if (this.started && !this.closed && this.playbackContext?.state !== 'running') this.callbacks.unavailable('device_unavailable'); };
      if (!this.captureContext.audioWorklet || !this.playbackContext.audioWorklet) throw new Error('AudioWorklet is unavailable');
      await Promise.all([this.captureContext.audioWorklet.addModule('/voice-worklet.js'), this.playbackContext.audioWorklet.addModule('/voice-worklet.js')]); return;
    }
    this.peer = new RTCPeerConnection(); this.sink = new Audio(); this.sink.muted = true;
    this.sink.onpause = () => { if (this.started && !this.closed && !this.detached) this.callbacks.unavailable('device_unavailable'); };
    if (requirements?.data_channel_label) { this.channel = this.peer.createDataChannel(requirements.data_channel_label); this.channel.onmessage = null; }
    for (const track of this.stream.getAudioTracks()) this.sender = this.peer.addTrack(track, this.stream);
    this.peer.ontrack = event => {
      if (this.closed || event.track.kind !== 'audio') { event.track.stop(); return; }
      this.remote = event.streams[0] ?? new MediaStream([event.track]); this.remoteReady?.();
    };
    this.peer.onconnectionstatechange = () => { if (!this.closed && ['failed', 'disconnected'].includes(this.peer!.connectionState)) this.callbacks.unavailable('network_lost'); };
    await this.peer.setLocalDescription(await this.peer.createOffer({ offerToReceiveAudio: true }));
    if (this.closed) throw new Error('Voice preparation cancelled');
    if (this.peer.iceGatheringState !== 'complete') await new Promise<void>((resolve, reject) => {
      const done = (error?: Error) => { clearTimeout(timer); this.peer?.removeEventListener('icegatheringstatechange', check); this.cancelNegotiation = undefined; if (error) reject(error); else resolve(); };
      const check = () => { if (this.peer?.iceGatheringState === 'complete') done(); };
      const timer = setTimeout(() => done(new Error('Native RTC negotiation deadline')), 8000); this.cancelNegotiation = () => done(new Error('Voice endpoint closed'));
      this.peer!.addEventListener('icegatheringstatechange', check); check();
    });
    if (this.closed) throw new Error('Voice preparation cancelled'); return this.peer.localDescription?.sdp;
  }
  async configure(negotiation: VoiceNegotiation, generation: number): Promise<DeviceSettings> {
    if (this.closed) throw new Error('Voice endpoint closed');
    this.generation = generation;
    if (this.transport === 'native_webrtc') {
      if (!negotiation.native_attachment || negotiation.input_spec || negotiation.output_spec) throw new Error('Native RTC must not duplicate relay media');
      await this.peer!.setRemoteDescription({ type: 'answer', sdp: negotiation.native_attachment.answer_sdp });
    } else {
      const input = negotiation.input_spec, output = negotiation.output_spec; if (!input || !output || negotiation.native_attachment) throw new Error('Relay negotiation needs both media specifications');
      validateSpec(input); validateSpec(output);
      this.inputSpec = input; this.outputSpec = output;
      this.captureNode = new AudioWorkletNode(this.captureContext!, 'nomifun-mobile-capture', { processorOptions: {
        sampleRate: input.format.sample_rate, channels: input.format.channels, frameDurationUs: Math.min(input.max_frame_duration_us, Math.max(input.min_frame_duration_us, 20000)),
        maxBufferUs: Math.min(200000, input.max_buffer_duration_us), maxAgeUs: Math.min(200000, input.max_frame_age_us),
      } });
      this.playbackNode = new AudioWorkletNode(this.playbackContext!, 'nomifun-mobile-playback', { numberOfInputs: 0, outputChannelCount: [output.format.channels], processorOptions: {
        channels: output.format.channels, maxBufferUs: Math.min(200000, output.max_buffer_duration_us), maxAgeUs: Math.min(200000, output.max_frame_age_us), generation: this.generation,
      } });
      this.captureNode.onprocessorerror = () => this.unavailable('device_unavailable');
      this.playbackNode.onprocessorerror = () => this.unavailable('device_unavailable');
      this.captureNode.port.onmessage = event => {
        const value = event.data; if (this.closed || this.paused || value.captureEpoch !== this.captureEpoch) return;
        if (value.kind === 'backlog') { this.unavailable('backlog'); return; }
        if (value.kind === 'level') this.callbacks.level(value.level);
        if (value.kind === 'capture') {
          // Preserve the worklet's original hardware admission clock. A stalled
          // JS turn cannot renew it merely by finally receiving the message.
          if (!this.foreground() || !Number.isFinite(value.admittedUs) || this.captureContext!.currentTime * 1e6 - value.admittedUs > Math.min(200000, input.max_frame_age_us)) {
            this.unavailable('backlog'); return;
          }
          const duration = Math.floor(value.frame_samples * 1e6 / input.format.sample_rate);
          if (this.inputCredits.has(value.sequence)) { this.unavailable('backlog'); return; }
          this.inputCredits.set(value.sequence, { epoch: this.captureEpoch, duration });
          this.callbacks.capture({ sequence: value.sequence, timestamp: Math.round(value.start_sample * input.timebase / input.format.sample_rate),
            duration_us: duration, format: input.format }, value.payload);
        }
      };
      this.playbackNode.port.onmessage = event => {
        if (this.closed) return; const value = event.data; if (value.kind === 'backlog') { this.unavailable('backlog'); return; }
        if (value.kind === 'flushed') {
          if (value.generation === this.generation) {
            this.outputBlocked = false; if (this.gain) this.gain.gain.value = this.localVolume;
            const pending = this.pendingOutput; this.pendingOutput = [];
            for (const item of pending) this.playbackNode!.port.postMessage({ kind: 'audio', ...item }, [item.payload]);
          }
          return;
        }
        for (const report of value.reports ?? []) {
          if (report.output_generation !== this.generation) continue;
          if (report.block_done) { const credit = this.outputCredits.get(report.sequence); if (credit) { this.outputUs -= credit.duration; this.outputCredits.delete(report.sequence); } }
          const key = `${report.output_generation}:${report.segment_id}:${report.revision}`;
          let record = this.rendered.get(key);
          if (!record) { record = { segment: report.segment_id, revision: report.revision, generation: report.output_generation,
            consumed: 0, end: 0, done: false, unknown: false, portions: [] }; this.rendered.set(key, record); }
          record.end = Math.max(record.end, report.consumed_us); record.done = report.block_done;
          record.portions.push({ start: report.render_start_us, end: report.render_end_us,
            before: report.consumed_before_us, after: report.consumed_us, observed: performance.now() });
          if (record.portions.length > 256) record.portions.shift();
          if (this.rendered.size > 256) this.rendered.delete(this.rendered.keys().next().value!);
        }
        this.reportPlayback();
      };
      this.source = this.captureContext!.createMediaStreamSource(this.stream!); this.source.connect(this.captureNode); this.captureNode.connect(this.captureContext!.destination);
      this.gain = this.playbackContext!.createGain(); this.playbackNode.connect(this.gain); this.gain.connect(this.playbackContext!.destination);
      this.outputClock = setInterval(() => this.reportPlayback(), 20);
    }
    const echo = this.stream?.getAudioTracks()[0]?.getSettings().echoCancellation;
    return { device_id: this.device, input_sample_rate: this.captureContext?.sampleRate, output_sample_rate: this.playbackContext?.sampleRate,
      echo_cancellation: typeof echo === 'boolean' ? echo : undefined };
  }
  async capture(enabled: boolean): Promise<void> {
    this.paused = !enabled; const epoch = ++this.captureEpoch; this.inputCredits.clear();
    if (!enabled) {
      for (const track of this.stream?.getTracks() ?? []) { track.enabled = false; track.removeEventListener('ended', this.trackEnded); track.stop(); }
      this.captureNode?.port.postMessage({ kind: 'pause', captureEpoch: this.captureEpoch }); this.source?.disconnect();
      await this.sender?.replaceTrack(null); await this.captureContext?.suspend(); return;
    }
    if (this.closed || !this.foreground()) throw new Error('Voice endpoint closed or backgrounded');
    if (this.stream?.getTracks().some(track => track.readyState === 'ended')) {
      if (!this.device) throw new Error('The original microphone identity is unavailable');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: this.device }, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (this.closed || this.paused || epoch !== this.captureEpoch || !this.foreground()) { stream.getTracks().forEach(track => track.stop()); return; } this.stream = stream;
      for (const track of stream.getTracks()) track.addEventListener('ended', this.trackEnded);
      if (this.captureContext && this.captureNode) { this.source = this.captureContext.createMediaStreamSource(stream); this.source.connect(this.captureNode); }
      if (this.sender) await this.sender.replaceTrack(stream.getAudioTracks()[0]);
    }
    for (const track of this.stream!.getTracks()) track.enabled = true;
    this.captureNode?.port.postMessage({ kind: 'resume', captureEpoch: this.captureEpoch });
    if (this.captureContext && this.playbackContext) await Promise.all([this.captureContext.resume(), this.playbackContext.resume()]);
    if (this.closed || this.paused || epoch !== this.captureEpoch || !this.foreground()) {
      this.stream?.getTracks().forEach(track => track.stop()); await this.captureContext?.suspend(); return;
    }
    if (this.sink && !this.detached) { this.sink.srcObject = this.remote ?? null; this.sink.muted = false; await this.sink.play(); }
    this.started = true;
  }
  returnInputCredit(sequence: number, durationUs: number): void {
    const credit = this.inputCredits.get(sequence); if (!credit || this.closed) return;
    if (credit.epoch !== this.captureEpoch) return;
    if (credit.duration !== durationUs) { this.unavailable('backlog'); return; }
    this.inputCredits.delete(sequence);
    this.captureNode?.port.postMessage({ kind: 'credit', sequence, durationUs, captureEpoch: credit.epoch });
  }
  async startOutput(): Promise<void> {
    if (this.closed) throw new Error('Voice endpoint closed');
    if (this.playbackContext) await this.playbackContext.resume();
    if (this.sink && !this.remote) await new Promise<void>((resolve, reject) => {
      const done = (error?: Error) => { clearTimeout(timer); this.remoteReady = undefined; this.cancelNegotiation = undefined; if (error) reject(error); else resolve(); };
      const timer = setTimeout(() => done(new Error('Native audio track deadline')), 8000);
      this.remoteReady = () => done(); this.cancelNegotiation = () => done(new Error('Voice endpoint closed'));
      if (this.remote) done();
    });
    if (this.closed) throw new Error('Voice endpoint closed');
    if (this.sink && !this.detached) { this.sink.srcObject = this.remote ?? null; this.sink.muted = false; await this.sink.play(); }
    this.started = true;
  }
  private reportPlayback(): void {
    if (this.closed || !this.playbackContext) return;
    if (!this.foreground()) { this.unavailable('device_unavailable'); return; }
    const now = performance.now();
    if ([...this.outputCredits.values()].some(credit => (now - credit.enqueued) * 1000 > Math.min(200000, this.outputSpec!.max_frame_age_us))) {
      this.unavailable('backlog'); return;
    }
    const timestamp = this.playbackContext.getOutputTimestamp?.();
    const clock = timestamp && Number.isFinite(timestamp.contextTime) && Number.isFinite(timestamp.performanceTime) &&
      timestamp.performanceTime! > 0 && timestamp.performanceTime! <= now + 1 && now - timestamp.performanceTime! < 1000
      ? timestamp.contextTime! * 1e6 : null;
    for (const record of this.rendered.values()) {
      let consumed = record.consumed;
      if (clock !== null) for (const part of record.portions) {
        if (clock < part.start) continue;
        const fraction = Math.min(1, Math.max(0, (clock - part.start) / Math.max(1, part.end - part.start)));
        consumed = Math.max(consumed, Math.floor(part.before + (part.after - part.before) * fraction));
      }
      const finished = clock !== null && record.done && consumed >= record.end;
      if (consumed > record.consumed || finished !== record.finished || (clock === null && !record.unknown)) {
        record.consumed = consumed; record.finished = finished; record.unknown = clock === null;
        this.callbacks.playback({ segment_id: record.segment, revision: record.revision, output_generation: record.generation,
          consumed_us: consumed, uncertain_tail_us: Math.max(0, record.end - consumed), precision: clock === null ? 'unknown' : 'estimated', finished });
      }
      // A missing device clock never turns software rendering into Played.
      // Keep only a bounded interval witness; dropping it makes no receipt.
      record.portions = record.portions.filter(part => part.after > record.consumed && (now - part.observed) * 1000 <= Math.max(200000, this.outputSpec!.max_frame_age_us));
    }
  }
  play(segment: OutputSegment, metadata: AudioMetadata, payload: ArrayBuffer): void {
    if (this.closed || metadata.output_generation !== this.generation || !this.playbackNode) return;
    try {
      validateAudio(metadata, payload, this.outputSpec!);
      if (!this.foreground() || this.outputCredits.has(metadata.sequence) || this.outputUs + metadata.duration_us > Math.min(200000, this.outputSpec!.max_buffer_duration_us)) throw new Error('Voice playback backlog');
      this.outputCredits.set(metadata.sequence, { duration: metadata.duration_us, enqueued: performance.now() }); this.outputUs += metadata.duration_us;
      const item = { metadata: { ...metadata, revision: segment.revision }, payload };
      if (this.outputBlocked) this.pendingOutput.push(item);
      else this.playbackNode.port.postMessage({ kind: 'audio', ...item }, [payload]);
    } catch { this.unavailable('backlog'); }
  }
  flush(generation: number): void {
    if (generation < this.generation) return;
    this.generation = generation; this.outputBlocked = true;
    if (this.gain) this.gain.gain.value = 0;
    this.pendingOutput = []; this.outputCredits.clear(); this.outputUs = 0; this.rendered.clear();
    this.playbackNode?.port.postMessage({ kind: 'flush', generation: this.generation });
    if (this.sink) { this.detached = true; this.sink.muted = true; this.sink.pause(); this.sink.srcObject = null; }
  }
  async resumeNativeBoundary(_attachment: string): Promise<void> { if (this.closed || !this.sink) return; this.detached = false; this.sink.srcObject = this.remote ?? null; this.sink.muted = false; await this.sink.play(); }
  volume(value: number): void { this.localVolume = Math.max(0, Math.min(1, value)); if (this.gain && !this.outputBlocked) this.gain.gain.value = this.localVolume; if (this.sink) this.sink.volume = this.localVolume; }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; this.paused = true; ++this.captureEpoch; this.inputCredits.clear(); this.cancelNegotiation?.();
    clearInterval(this.outputClock); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibility);
    this.permission?.removeEventListener('change', this.denied);
    if (typeof navigator !== 'undefined') navigator.mediaDevices?.removeEventListener('devicechange', this.changed);
    this.flush(this.generation + 1); if (this.peer) { this.peer.ontrack = null; this.peer.onconnectionstatechange = null; } this.peer?.close(); this.channel?.close();
    for (const track of this.stream?.getTracks() ?? []) { track.removeEventListener('ended', this.trackEnded); track.stop(); }
    this.remote?.getTracks().forEach(track => track.stop()); this.captureNode?.disconnect(); this.playbackNode?.disconnect(); this.source?.disconnect(); this.gain?.disconnect();
    if (this.captureNode) this.captureNode.port.onmessage = null; if (this.playbackNode) this.playbackNode.port.onmessage = null;
    if (this.captureNode) this.captureNode.onprocessorerror = null; if (this.playbackNode) this.playbackNode.onprocessorerror = null;
    if (this.captureContext) this.captureContext.onstatechange = null; if (this.playbackContext) this.playbackContext.onstatechange = null; if (this.sink) this.sink.onpause = null;
    this.captureNode?.port.postMessage({ kind: 'pause', captureEpoch: this.captureEpoch }); this.playbackNode?.port.postMessage({ kind: 'close' });
    const completion = (async () => {
      await this.preparing?.catch(() => {});
      const results = await Promise.allSettled([this.captureContext?.close(), this.playbackContext?.close()]);
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Audio resource cleanup is unconfirmed');
      this.captureNode?.port.close(); this.playbackNode?.port.close();
      if (WebEndpoint.owner === this) WebEndpoint.owner = undefined;
    })();
    this.closing = new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Audio resource cleanup is unconfirmed')), 1000);
      completion.then(() => { clearTimeout(deadline); resolve(); }, error => { clearTimeout(deadline); reject(error); });
    });
    return this.closing;
  }
}
const secureDevices = globalThis.isSecureContext && typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
export const endpointFactory: EndpointFactory = { transports: secureDevices ? [
  ...(typeof AudioContext === 'function' && typeof AudioWorkletNode === 'function' ? ['relay' as const] : []),
  ...(typeof RTCPeerConnection === 'function' ? ['native_webrtc' as const] : []),
] : [], create: callbacks => new WebEndpoint(callbacks) };
