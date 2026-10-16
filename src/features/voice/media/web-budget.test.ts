import { expect, test } from 'bun:test';
import { PcmCaptureBudget, PcmCaptureEncoder, PcmPlaybackQueue } from '../../../../public/voice-dsp.js';

// These use the production DSP classes with an explicit audio-thread clock.
// They prove contract logic only; actual AudioWorklet/browser proof is separate.
test('Web hardware credit remains charged through conversion until exact server disposition', () => {
  const budget = new PcmCaptureBudget(40_000, 100_000); budget.begin(1);
  expect(budget.admit(20_000, 0)).toBe(true);
  expect(budget.issue(1, 20_000, 10_000)).toEqual({ captureEpoch: 1, admittedUs: 0 });
  expect(budget.admit(20_000, 10_000)).toBe(true); budget.issue(2, 20_000, 10_000);
  expect(budget.acknowledge(1, 99, 20_000, 20_000)).toBe(false);
  expect(budget.usedUs).toBe(40_000);
  expect(budget.acknowledge(1, 1, 20_000, 20_000)).toBe(true);
  expect(budget.acknowledge(1, 1, 20_000, 20_000)).toBe(false);
  expect(budget.admit(20_000, 20_000)).toBe(true);
  expect(budget.admit(1, 20_000)).toBe(false);
  expect(budget.expired).toBe(true);
});

test('Web wrong disposition duration latches failure without creating capacity', () => {
  const budget = new PcmCaptureBudget(20_000, 100_000); budget.begin(7);
  budget.admit(20_000, 0); budget.issue(1, 20_000, 0);
  expect(() => budget.acknowledge(7, 1, 10_000, 100)).toThrow('mismatch');
  expect(budget.usedUs).toBe(20_000);
  expect(budget.check(200)).toBe(false);
});

test('Web late ACK cannot erase audio-thread age expiry after a stalled JS turn', () => {
  const budget = new PcmCaptureBudget(40_000, 100_000); budget.begin(1);
  budget.admit(20_000, 0); budget.issue(1, 20_000, 10_000);
  expect(budget.acknowledge(1, 1, 20_000, 100_001)).toBe(false);
  expect(budget.expired).toBe(true);
  expect(budget.admit(20_000, 100_002)).toBe(false);
  expect(budget.issue(2, 20_000, 100_002)).toBeUndefined();
  budget.begin(2);
  expect(budget.admit(20_000, 100_002)).toBe(true);
});

test('Web raw conversion preserves hardware age and partial-duration accounting', () => {
  const budget = new PcmCaptureBudget(30_000, 100_000); budget.begin(1);
  budget.admit(10_000, 0); budget.admit(20_000, 20_000);
  expect(budget.issue(1, 15_000, 40_000)).toEqual({ captureEpoch: 1, admittedUs: 0 });
  expect(budget.issue(2, 15_000, 40_000)).toEqual({ captureEpoch: 1, admittedUs: 20_000 });
  budget.acknowledge(1, 1, 15_000, 50_000);
  expect(budget.usedUs).toBe(15_000);
  expect(budget.check(120_001)).toBe(false);
});

test('Web pause invalidates old epochs and encoder resume never reuses sequence', () => {
  const budget = new PcmCaptureBudget(40_000, 100_000);
  const encoder = new PcmCaptureEncoder(48_000, 16_000, 1, 20_000);
  budget.begin(1); budget.admit(20_000, 0);
  const first = encoder.push([new Float32Array(961)])[0]!;
  budget.issue(first.sequence, 20_000, 0);
  encoder.clear(); budget.end(); budget.begin(3); budget.admit(20_000, 50_000);
  const fresh = encoder.push([new Float32Array(961)])[0]!;
  budget.issue(fresh.sequence, 20_000, 50_000);
  expect(fresh.sequence).toBeGreaterThan(first.sequence);
  expect(budget.acknowledge(1, first.sequence, 20_000, 60_000)).toBe(false);
  expect(budget.acknowledge(3, first.sequence, 20_000, 60_000)).toBe(false);
  expect(budget.usedUs).toBe(20_000);
  expect(budget.acknowledge(3, fresh.sequence, 20_000, 60_000)).toBe(true);
});

test('Web software rendering exposes interval witnesses without claiming speaker consumption', () => {
  const queue = new PcmPlaybackQueue(16_000, 1, 100_000, 100_000); queue.flush(2);
  const metadata = { segment_id: 'a', revision: 1, output_generation: 2, duration_us: 20_000,
    format: { sample_rate: 16_000, channels: 1 } };
  queue.push(metadata, new ArrayBuffer(640), 0);
  const rendered = queue.render([new Float32Array(160)], 30_000).reports[0]!;
  expect(rendered.render_start_us).toBe(30_000);
  expect(rendered.render_end_us).toBe(40_000);
  expect(rendered.consumed_before_us).toBe(0);
  expect(rendered.consumed_us).toBe(10_000);
  expect(rendered.block_done).toBe(false);
  queue.flush(1); // A stale flush cannot withdraw the newer generation.
  expect(queue.render([new Float32Array(160)], 40_000).reports[0]!.consumed_us).toBe(20_000);
  queue.flush(3);
  expect(queue.render([new Float32Array(160)], 50_000).reports).toEqual([]);
});
