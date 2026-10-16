/** Mobile PCM endpoint DSP. Product identities and real format clocks only. */
/** Hardware credit stays charged through conversion, MessagePort and server
 * disposition. Its clock belongs to the worklet, never the receiving JS turn. */
export class PcmCaptureBudget {
  constructor(maxDurationUs, maxAgeUs) {
    if (!Number.isFinite(maxDurationUs) || maxDurationUs <= 0 || !Number.isFinite(maxAgeUs) || maxAgeUs <= 0) throw new Error('Invalid capture budget');
    this.maxDurationUs = maxDurationUs; this.maxAgeUs = maxAgeUs;
    this.epoch = 0; this.active = false; this.expired = false;
    this.usedUs = 0; this.rawUs = 0; this.raw = []; this.permits = new Map();
  }
  begin(epoch) { this.end(); this.epoch = epoch; this.active = true; this.expired = false; }
  end() { this.active = false; this.usedUs = 0; this.rawUs = 0; this.raw = []; this.permits.clear(); }
  check(nowUs) {
    if (!this.active || this.expired) return false;
    if (!Number.isFinite(nowUs) || (this.raw.length && nowUs - this.raw[0].admittedUs > this.maxAgeUs) ||
      [...this.permits.values()].some(permit => nowUs - permit.admittedUs > this.maxAgeUs)) {
      this.expired = true; this.active = false; return false;
    }
    return true;
  }
  admit(durationUs, nowUs) {
    if (!this.check(nowUs)) return false;
    if (!Number.isFinite(durationUs) || durationUs <= 0 || this.usedUs + durationUs > this.maxDurationUs + .000001) {
      this.expired = true; this.active = false; return false;
    }
    this.raw.push({ durationUs, admittedUs: nowUs }); this.rawUs += durationUs; this.usedUs += durationUs; return true;
  }
  issue(sequence, durationUs, nowUs) {
    if (!this.check(nowUs)) return;
    if (!Number.isSafeInteger(sequence) || sequence < 0 || this.permits.has(sequence) || durationUs <= 0 || this.rawUs + 1 < durationUs) {
      this.expired = true; this.active = false; return;
    }
    const charge = Math.min(this.rawUs, durationUs), admittedUs = this.raw[0].admittedUs;
    this.permits.set(sequence, { durationUs, charge, admittedUs }); this.rawUs -= charge;
    let remaining = charge;
    while (remaining > .000001 && this.raw.length) {
      const amount = Math.min(remaining, this.raw[0].durationUs);
      remaining -= amount; this.raw[0].durationUs -= amount;
      if (this.raw[0].durationUs < .000001) this.raw.shift();
    }
    return { captureEpoch: this.epoch, admittedUs };
  }
  acknowledge(epoch, sequence, durationUs, nowUs) {
    if (epoch !== this.epoch) return false;
    if (!this.check(nowUs)) return false;
    const permit = this.permits.get(sequence); if (!permit) return false;
    if (permit.durationUs !== durationUs) { this.expired = true; this.active = false; throw new Error('Voice capture credit mismatch'); }
    this.usedUs = Math.max(0, this.usedUs - permit.charge); this.permits.delete(sequence); return true;
  }
}

export class PcmCaptureEncoder {
  constructor(inputRate, outputRate, channels, frameDurationUs) {
    this.inputRate = inputRate;
    this.outputRate = outputRate;
    this.channels = channels;
    this.frameSamples = Math.max(1, Math.round(outputRate * frameDurationUs / 1000000));
    this.pending = [];
    this.position = 0;
    this.encoded = [];
    this.sequence = 0;
    this.totalSamples = 0;
  }
  push(inputChannels) {
    if (!inputChannels.length || !inputChannels[0].length) return [];
    const length = inputChannels[0].length;
    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < this.channels; channel++) {
        const value = this.channels === 1 ? inputChannels.reduce((sum, input) => sum + (input[i] ?? 0), 0) / inputChannels.length
          : (inputChannels[channel] ?? inputChannels[0])[i] ?? 0;
        this.pending.push(value);
      }
    }
    const available = this.pending.length / this.channels;
    const step = this.inputRate / this.outputRate;
    while (this.position + 1 < available) {
      const index = Math.floor(this.position);
      const fraction = this.position - index;
      for (let channel = 0; channel < this.channels; channel++) {
        const first = this.pending[index * this.channels + channel];
        const next = this.pending[(index + 1) * this.channels + channel];
        const value = Math.max(-1, Math.min(1, first + (next - first) * fraction));
        this.encoded.push(Math.round(value * (value < 0 ? 32768 : 32767)));
      }
      this.position += step;
    }
    const consumed = Math.min(Math.floor(this.position), Math.max(0, available - 1));
    this.pending.splice(0, consumed * this.channels);
    this.position -= consumed;
    const frames = [];
    while (this.encoded.length >= this.frameSamples * this.channels) {
      const payload = new ArrayBuffer(this.frameSamples * this.channels * 2);
      const view = new DataView(payload);
      for (let index = 0; index < this.frameSamples * this.channels; index++) view.setInt16(index * 2, this.encoded[index], true);
      this.encoded.splice(0, this.frameSamples * this.channels);
      frames.push({ payload, sequence: this.sequence++, start_sample: this.totalSamples, frame_samples: this.frameSamples });
      this.totalSamples += this.frameSamples;
    }
    return frames;
  }
  clear() { this.pending.length = 0; this.encoded.length = 0; this.position = 0; }
}

export function resamplePcm16(payload, inputRate, inputChannels, outputRate, outputChannels) {
  const view = new DataView(payload);
  if (payload.byteLength % (inputChannels * 2)) throw new Error('Partial PCM sample frame');
  const inputFrames = payload.byteLength / (inputChannels * 2);
  if (!inputFrames) return new Float32Array(0);
  const count = Math.round(inputFrames * outputRate / inputRate);
  const samples = new Float32Array(count * outputChannels);
  for (let frame = 0; frame < count; frame++) {
    const position = frame * inputRate / outputRate;
    const index = Math.min(Math.floor(position), inputFrames - 1);
    const next = Math.min(index + 1, inputFrames - 1);
    const fraction = position - index;
    for (let channel = 0; channel < outputChannels; channel++) {
      // A mono endpoint is an explicit downmix; stereo and wider output keep
      // each available channel, and duplicate mono only when required.
      let first = 0, second = 0;
      const start = outputChannels === 1 ? 0 : Math.min(channel, inputChannels - 1);
      const end = outputChannels === 1 ? inputChannels : start + 1;
      for (let source = start; source < end; source++) {
        first += view.getInt16((index * inputChannels + source) * 2, true) / 32768;
        second += view.getInt16((next * inputChannels + source) * 2, true) / 32768;
      }
      samples[frame * outputChannels + channel] = (first + (second - first) * fraction) / (end - start);
    }
  }
  return samples;
}

export class PcmPlaybackQueue {
  constructor(outputRate, outputChannels, maxBufferUs, maxAgeUs) {
    this.outputRate = outputRate; this.outputChannels = outputChannels;
    this.maxBufferUs = maxBufferUs; this.maxAgeUs = maxAgeUs;
    this.generation = 0; this.blocks = []; this.bufferedUs = 0;
    this.consumed = new Map(); this.hadAudio = false;
  }
  push(metadata, payload, nowUs) {
    if (metadata.output_generation !== this.generation) return false;
    if (this.bufferedUs + metadata.duration_us > this.maxBufferUs) throw new Error('Voice playback duration backlog');
    const samples = resamplePcm16(payload, metadata.format.sample_rate, metadata.format.channels, this.outputRate, this.outputChannels);
    this.blocks.push({ metadata, samples, offset: 0, enqueuedUs: nowUs });
    this.bufferedUs += metadata.duration_us; this.hadAudio = true;
    return true;
  }
  flush(generation) { if (generation < this.generation) return; this.blocks.length = 0; this.bufferedUs = 0; this.generation = generation; this.hadAudio = false; }
  revoke(segmentId, revision, generation) {
    this.blocks = this.blocks.filter(block => block.metadata.segment_id !== segmentId || block.metadata.revision > revision || block.metadata.output_generation !== generation);
    this.bufferedUs = this.blocks.reduce((sum, block) => sum + (block.samples.length - block.offset) / this.outputChannels / this.outputRate * 1000000, 0);
  }
  render(outputs, nowUs) {
    const length = outputs[0]?.length ?? 0;
    for (const output of outputs) output.fill(0);
    const reports = []; let portion;
    for (let frame = 0; frame < length; frame++) {
      const block = this.blocks[0];
      if (!block) break;
      if (nowUs - block.enqueuedUs > this.maxAgeUs) { this.flush(this.generation); throw new Error('Voice playback age backlog'); }
      const key = `${block.metadata.output_generation}:${block.metadata.segment_id}:${block.metadata.revision}`;
      if (!portion || portion.sequence !== block.metadata.sequence) {
        portion = { ...block.metadata, render_start_us: nowUs + frame * 1000000 / this.outputRate,
          render_end_us: nowUs + frame * 1000000 / this.outputRate,
          consumed_before_us: this.consumed.get(key) ?? 0, consumed_us: this.consumed.get(key) ?? 0, block_done: false };
        reports.push(portion);
      }
      for (let channel = 0; channel < outputs.length; channel++) {
        outputs[channel][frame] = block.samples[block.offset + Math.min(channel, this.outputChannels - 1)] ?? 0;
      }
      block.offset += this.outputChannels;
      this.bufferedUs = Math.max(0, this.bufferedUs - 1000000 / this.outputRate);
      this.consumed.set(key, (this.consumed.get(key) ?? 0) + 1000000 / this.outputRate);
      portion.render_end_us = nowUs + (frame + 1) * 1000000 / this.outputRate;
      portion.consumed_us = this.consumed.get(key);
      if (this.consumed.size > 512) this.consumed.delete(this.consumed.keys().next().value);
      if (block.offset >= block.samples.length) {
        portion.block_done = true;
        this.blocks.shift();
        portion = undefined;
      }
    }
    for (const report of reports) { report.consumed_before_us = Math.round(report.consumed_before_us); report.consumed_us = Math.round(report.consumed_us); }
    return { reports, buffered_us: Math.round(this.bufferedUs), underflow: this.hadAudio && this.blocks.length === 0 };
  }
}
