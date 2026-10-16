import { PcmCaptureEncoder, PcmCaptureBudget, PcmPlaybackQueue } from './voice-dsp.js';
class Capture extends AudioWorkletProcessor {
  constructor(options) {
    super(); const settings = options.processorOptions;
    this.encoder = new PcmCaptureEncoder(sampleRate, settings.sampleRate, settings.channels, settings.frameDurationUs);
    this.budget = new PcmCaptureBudget(settings.maxBufferUs, settings.maxAgeUs);
    this.active = false; this.captureEpoch = 0; this.lastLevel = 0;
    this.port.onmessage = event => {
      const message = event.data;
      try {
        if (message.kind === 'credit') {
          this.budget.acknowledge(message.captureEpoch, message.sequence, message.durationUs, currentTime * 1e6);
          if (this.budget.expired) this.fail();
          return;
        }
        if (message.kind !== 'pause' && message.kind !== 'resume') return;
        if (message.captureEpoch < this.captureEpoch) return;
        this.captureEpoch = message.captureEpoch; this.encoder.clear();
        this.active = message.kind === 'resume';
        if (this.active) { this.budget.begin(this.captureEpoch); this.failed = false; }
        else this.budget.end();
      } catch { this.fail(); }
    };
  }
  fail() {
    this.active = false; this.encoder.clear();
    if (!this.failed) { this.failed = true; this.port.postMessage({ kind: 'backlog', captureEpoch: this.captureEpoch }); }
  }
  process(inputs) {
    if (!this.active) return true;
    const input = inputs[0] ?? [];
    const nowUs = currentTime * 1e6;
    if (!this.budget.check(nowUs)) { this.fail(); return true; }
    if (input[0]?.length && !this.budget.admit(input[0].length * 1e6 / sampleRate, nowUs)) { this.fail(); return true; }
    for (const frame of this.encoder.push(input)) {
      const permit = this.budget.issue(frame.sequence, Math.floor(frame.frame_samples * 1e6 / this.encoder.outputRate), nowUs);
      if (!permit) { this.fail(); return true; }
      this.port.postMessage({ kind: 'capture', ...permit, ...frame }, [frame.payload]);
    }
    if (currentTime - this.lastLevel > .08 && input[0]?.length) {
      const rms = Math.sqrt(input[0].reduce((sum, value) => sum + value * value, 0) / input[0].length);
      this.port.postMessage({ kind: 'level', captureEpoch: this.captureEpoch, level: Math.min(1, rms * 4) }); this.lastLevel = currentTime;
    }
    return true;
  }
}
class Playback extends AudioWorkletProcessor {
  constructor(options) {
    super(); const settings = options.processorOptions;
    this.queue = new PcmPlaybackQueue(sampleRate, settings.channels, settings.maxBufferUs, settings.maxAgeUs);
    this.queue.flush(settings.generation); this.closed = false; this.lastReport = 0;
    this.port.onmessage = event => {
      const message = event.data;
      try {
        if (message.kind === 'audio') this.queue.push(message.metadata, message.payload, currentTime * 1e6);
        if (message.kind === 'flush') {
          this.queue.flush(message.generation);
          this.port.postMessage({ kind: 'flushed', generation: this.queue.generation });
        }
        if (message.kind === 'close') { this.queue.flush(this.queue.generation + 1); this.closed = true; }
      } catch { this.queue.flush(this.queue.generation); this.port.postMessage({ kind: 'backlog' }); }
    };
  }
  process(_inputs, outputs) {
    if (this.closed) return false;
    try {
      const result = this.queue.render(outputs[0] ?? [], currentTime * 1e6);
      if (result.reports.length) {
        this.port.postMessage({ kind: 'playback', ...result }); this.lastReport = currentTime;
      }
    } catch { this.port.postMessage({ kind: 'backlog' }); }
    return true;
  }
}
registerProcessor('nomifun-mobile-capture', Capture);
registerProcessor('nomifun-mobile-playback', Playback);
