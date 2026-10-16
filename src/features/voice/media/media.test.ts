import { expect, test } from 'bun:test';
import { InputCredits } from './credits';
import { decodePacket, encodePacket, validateAudio } from './codec';
import { PcmCaptureEncoder, PcmPlaybackQueue } from '../../../../public/voice-dsp.js';
test('credit admission uses duration and real elapsed age, not message count or work receipts', () => {
  let now = 0; const credits = new InputCredits(40000, 100000, () => now);
  credits.admit(1, 20000); credits.admit(2, 20000); expect(() => credits.admit(3, 10000)).toThrow();
  expect(() => credits.acknowledge(1, 10000)).toThrow(); credits.acknowledge(1, 20000); credits.admit(3, 10000);
  now = 101; expect(() => credits.checkAge()).toThrow(); credits.clear(); expect(credits.duration).toBe(0);
});
test('NFV framing preserves PCM identity and rejects contradictory payload durations', () => {
  const format = { encoding: 'pcm' as const, sample_format: 'signed16_le' as const, sample_rate: 16000, channels: 1 };
  const metadata = { activation_epoch: 3, output_generation: 2, sequence: 5, timestamp: 1600, duration_us: 20000, format };
  const spec = { format, timebase: 16000, min_frame_duration_us: 10000, max_frame_duration_us: 40000, max_frame_bytes: 1280, max_buffer_duration_us: 100000, max_frame_age_us: 200000 };
  const decoded = decodePacket(encodePacket(metadata, new ArrayBuffer(640))); expect(decoded.metadata).toEqual(metadata);
  validateAudio(decoded.metadata, decoded.payload, spec); expect(() => validateAudio({ ...metadata, duration_us: 30000 }, decoded.payload, spec)).toThrow();
});
test('H5 DSP converts hardware clock to negotiated PCM and requires explicit output generation', () => {
  const capture = new PcmCaptureEncoder(48000, 16000, 1, 20000); const frames = capture.push([new Float32Array(2881).fill(.4)]);
  expect(frames.length).toBe(3); expect(frames[0].payload.byteLength).toBe(640);
  const queue = new PcmPlaybackQueue(48000, 1, 40000, 100000); queue.flush(1);
  const metadata = { segment_id: 's', revision: 1, output_generation: 2, duration_us: 20000, format: { sample_rate: 16000, channels: 1 } };
  expect(queue.push(metadata, frames[0].payload, 0)).toBe(false); expect(queue.push({ ...metadata, output_generation: 1 }, frames[0].payload, 0)).toBe(true);
  const result = queue.render([new Float32Array(480)], 1000); expect(result.reports[0].consumed_us).toBe(10000);
  queue.flush(2); expect(queue.render([new Float32Array(480)], 2000).reports.length).toBe(0);
});
