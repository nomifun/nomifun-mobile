import { expect, test } from 'bun:test';
import { distribution, VoiceDiagnostics } from './diagnostics';
test('unmeasured audio is null, not a fabricated zero-latency result', () => {
  const diagnostics = new VoiceDiagnostics(); expect(diagnostics.report().local_flush_invocation).toEqual({ samples: 0, p50_ms: null, p95_ms: null });
});
test('bounded observations summarize p50/p95 without changing the original samples', () => {
  const samples = [8, 2, 20, 10]; expect(distribution(samples)).toEqual({ samples: 4, p50_ms: 8, p95_ms: 20 }); expect(samples).toEqual([8, 2, 20, 10]);
  const diagnostics = new VoiceDiagnostics(); for (let index = 0; index < 300; index++) diagnostics.add(diagnostics.inputAckMs, index);
  expect(diagnostics.report().input_admission_ack.samples).toBe(200);
});
