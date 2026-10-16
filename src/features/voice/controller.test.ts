/** Controller contract harness, not device/vendor experience acceptance. */
import { expect, test } from 'bun:test';
import { VoiceController, type MediaSocket, type VoiceAPI } from './controller';
import type { AudioMetadata, ProductEvent, SourceContextConfirmation, SourceContextRequirement, Transport, VoiceActivation, VoiceBinding, VoiceControl, VoiceNegotiation, WorkRequest } from './contracts';
import type { EndpointFactory, MediaCallbacks, VoiceMediaEndpoint } from './media/types';
import { encodePacket } from './media/codec';

const spec = { format: { encoding: 'pcm' as const, sample_format: 'signed16_le' as const, sample_rate: 16000, channels: 1 }, timebase: 16000,
  min_frame_duration_us: 10000, max_frame_duration_us: 20000, max_frame_bytes: 640, max_buffer_duration_us: 60000, max_frame_age_us: 200000 };
const binding: VoiceBinding = { agent_session_id: 'work-session', binding_version: 7, profile_id: 'voice-profile', profile_revision: 3, label: 'Original work', transport: 'relay' };
const target = { agent_session_id: binding.agent_session_id, binding_version: 7, turn_operation_id: 'original-turn', execution_generation: 2 };
function activation(epoch = 1): VoiceActivation { return { voice_session_id: 'voice-session', activation_epoch: epoch, attachment_token: 'short-capability',
  state: { voice_session_id: 'voice-session', agent_session_id: binding.agent_session_id, binding_version: 7, activation_epoch: epoch, output_generation: 1,
    capture: 'idle', connection: 'ready', playback: 'idle', work_running: true },
  negotiation: { capabilities: {}, input_spec: spec, output_spec: spec } }; }
class Socket implements MediaSocket {
  readyState = 1; binaryType = 'arraybuffer'; bufferedAmount = undefined;
  onopen: (() => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  sent: Array<ArrayBuffer | string> = []; closed = false;
  send(data: ArrayBuffer | string) { this.sent.push(data); }
  close() { this.closed = true; }
  event(data: ProductEvent) { this.onmessage?.({ data: JSON.stringify(data) }); }
}
class Endpoint implements VoiceMediaEndpoint {
  closed = false; prepared = false; captures: boolean[] = []; flushes: number[] = []; played = 0;
  returnedCredits: Array<[number, number]> = [];
  constructor(readonly callbacks: MediaCallbacks) {}
  async prepare() { this.prepared = true; return undefined; }
  async configure(_negotiation: VoiceNegotiation) { return { echo_cancellation: true }; }
  async capture(enabled: boolean) { this.captures.push(enabled); }
  play() { this.played++; }
  flush(generation: number) { this.flushes.push(generation); }
  async resumeNativeBoundary() {}
  volume() {}
  returnInputCredit(sequence: number, duration: number) { this.returnedCredits.push([sequence, duration]); }
  async close() { this.closed = true; }
  input(sequence: number) { this.callbacks.capture({ sequence, timestamp: sequence * 320, duration_us: 20000, format: spec.format }, new ArrayBuffer(640)); }
}
function harness(extra: Partial<VoiceAPI> = {}, transports: Transport[] = ['relay']) {
  const endpoints: Endpoint[] = [], sockets: Socket[] = [], controls: VoiceControl[] = [], work: WorkRequest[] = []; let activated = 0;
  let foreground = true;
  let now = Date.now();
  const confirmations: Array<{ id: string; confirmation: SourceContextConfirmation; signal: AbortSignal }> = [];
  const factory: EndpointFactory = { transports, create(callbacks) { const endpoint = new Endpoint(callbacks); endpoints.push(endpoint); return endpoint; } };
  const api: VoiceAPI = { availability: async () => ({ enabled: true, binding_version: 7 }),
    activate: async () => { activated++; return activation(); }, control: async (id, epoch, control) => { controls.push(control);
      return { ...activation(epoch).state, voice_session_id: id, capture: control.kind === 'mute_input' && control.muted ? 'paused' : 'capturing' }; },
    attachment: async () => activation(2), projection: async (id, epoch) => ({ state: { ...activation(epoch).state, voice_session_id: id }, transcripts: [], playback_receipts: [], approvals: [], source_context_requirement: null }),
    confirmSourceContext: async (id, confirmation, signal) => { confirmations.push({ id, confirmation, signal }); return { confirmed: true }; },
    work: async (_id, _epoch, request, key) => { work.push(request); return { operation_key: key, receipt_id: 'canonical-receipt', status: 'accepted', summary: 'Requested', duplicate: false, target }; }, ...extra };
  const controller = new VoiceController({ api, endpoints: factory, socket() { const socket = new Socket(); sockets.push(socket); return socket; },
    now: () => now, identity: () => 'public-operation', foreground: () => foreground });
  return { controller, endpoints, sockets, controls, work, confirmations, activations: () => activated, advanceClock: (milliseconds: number) => { now += milliseconds; }, background: () => { foreground = false; controller.background(); } };
}
test('off and observer acquire no microphone, media socket or model activation', async () => {
  const h = harness(); expect(h.endpoints.length).toBe(0);
  await h.controller.observe(binding, 'remote', 1);
  expect(h.controller.getSnapshot().role).toBe('observer'); expect(h.controller.getSnapshot().microphone).toBe('off');
  expect(h.endpoints.length).toBe(0); expect(h.sockets.length).toBe(0); expect(h.activations()).toBe(0);
  await h.controller.end(); expect(h.controls.length).toBe(0);
});
test('observer snapshots remove revoked text without resurrecting it and retain only consumed timing', async () => {
  const user = { speaker: 'user' as const, fragment_id: 'user', revision: 1, commit: 'committed' as const, text: 'Change the source' };
  const withdrawn = { speaker: 'assistant' as const, fragment_id: 'canonical-source', revision: 1, commit: 'committed' as const, text: 'Withdrawn full sentence' };
  let polls = 0;
  const h = harness({ projection: async (id, epoch) => {
    polls++; return { state: { ...activation(epoch).state, voice_session_id: id, output_generation: polls === 1 ? 1 : 2 },
      transcripts: polls === 1 ? [user, withdrawn] : [user], approvals: [], source_context_requirement: null, playback_receipts: polls === 2 ? [{
        activation_epoch: epoch, segment_id: 'different-supplier-segment', revision: 1, output_generation: 1, state: 'revoked',
        consumed_us: 9000, uncertain_tail_us: 1000, precision: 'estimated' }] : [] };
  } });
  try {
    await h.controller.observe(binding, 'remote-voice', 1);
    expect(h.controller.getSnapshot().captions.map(item => item.text)).toEqual([user.text, withdrawn.text]);
    for (let attempt = 0; polls < 3 && attempt < 200; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(polls).toBeGreaterThanOrEqual(3);
    const captions = h.controller.getSnapshot().captions;
    expect(captions.some(item => item.text === withdrawn.text)).toBe(false); expect(captions.some(item => item.text === user.text)).toBe(true);
    const timings = captions.filter(item => item.speaker === 'assistant'); expect(timings.length).toBe(1);
    expect(timings[0]).toMatchObject({ text: '', timingOnly: true, outputGeneration: 1, consumedUs: 9000, playbackPrecision: 'estimated' });
    expect(h.endpoints.length).toBe(0); expect(h.activations()).toBe(0); expect(h.work.length).toBe(0);
  } finally { await h.controller.end(); }
});
const sourceRequirement: SourceContextRequirement = { source_ref: { fragment_id: 'intent-source', revision: 1 }, context: { context_key: 'exact-context', target } };
const intentSource = { speaker: 'user' as const, fragment_id: 'intent-source', revision: 1, commit: 'committed' as const, text: 'Cancel the current task' };
function presentSource(h: ReturnType<typeof harness>, requirement = sourceRequirement) {
  h.sockets[0].event({ kind: 'model', event: { kind: 'transcript', fragment: intentSource } });
  h.sockets[0].event({ kind: 'source_context_changed', requirement });
}
async function rejectsSource(operation: () => Promise<void>) {
  let rejected = false; try { await operation(); } catch { rejected = true; }
  expect(rejected).toBe(true);
}
test('source target confirmation requires an explicit human action and sends only the exact displayed context', async () => {
  const h = harness();
  try {
    await h.controller.start(binding); presentSource(h);
    expect(h.controller.sourceContextText(sourceRequirement)).toBe(intentSource.text); expect(h.confirmations.length).toBe(0); expect(h.work.length).toBe(0);
    await h.controller.confirmSourceContext(sourceRequirement);
    expect(h.confirmations[0]).toMatchObject({ id: 'voice-session', confirmation: { activation_epoch: 1, source_ref: sourceRequirement.source_ref, context_key: 'exact-context' } });
    expect(h.controller.getSnapshot().sourceContextRequirement).toBeUndefined(); expect(h.work.length).toBe(0);
  } finally { await h.controller.end(); }
});
test('changed task targets and absent targets invalidate old displayed confirmation actions', async () => {
  const h = harness();
  const changed: SourceContextRequirement = { ...sourceRequirement, context: { context_key: 'new-context', target: { ...target, turn_operation_id: 'new-turn' } } };
  try {
    await h.controller.start(binding); presentSource(h);
    h.sockets[0].event({ kind: 'source_context_changed', requirement: changed });
    await rejectsSource(() => h.controller.confirmSourceContext(sourceRequirement));
    await rejectsSource(() => h.controller.confirmSourceContext({ ...changed, context: { ...changed.context, target } }));
    expect(h.confirmations.length).toBe(0);
    h.sockets[0].event({ kind: 'source_context_changed', requirement: { ...changed, context: { context_key: 'no-task', target: null } } });
    await rejectsSource(() => h.controller.confirmSourceContext(h.controller.getSnapshot().sourceContextRequirement!));
    expect(h.confirmations.length).toBe(0);
    h.sockets[0].event({ kind: 'source_context_changed', requirement: null });
    expect(h.controller.getSnapshot().sourceContextRequirement).toBeUndefined();
  } finally { await h.controller.end(); }
});
test('a missing or revised exact human source cannot be confirmed from vendor context alone', async () => {
  const h = harness();
  try {
    await h.controller.start(binding);
    h.sockets[0].event({ kind: 'source_context_changed', requirement: sourceRequirement });
    await rejectsSource(() => h.controller.confirmSourceContext(sourceRequirement));
    presentSource(h);
    h.sockets[0].event({ kind: 'model', event: { kind: 'transcript', fragment: { ...intentSource, revision: 2, text: 'Keep working instead' } } });
    expect(h.controller.getSnapshot().sourceContextRequirement).toBeUndefined();
    await rejectsSource(() => h.controller.confirmSourceContext(sourceRequirement)); expect(h.confirmations.length).toBe(0); expect(h.work.length).toBe(0);
  } finally { await h.controller.end(); }
});
test('observer projection can display a source requirement but cannot confirm or acquire media', async () => {
  const h = harness({ projection: async (id, epoch) => ({ state: { ...activation(epoch).state, voice_session_id: id }, transcripts: [intentSource],
    approvals: [], playback_receipts: [], source_context_requirement: sourceRequirement }) });
  try {
    await h.controller.observe(binding, 'remote-voice', 1);
    expect(h.controller.sourceContextText(sourceRequirement)).toBe(intentSource.text);
    await rejectsSource(() => h.controller.confirmSourceContext(sourceRequirement));
    expect(h.confirmations.length).toBe(0); expect(h.activations()).toBe(0); expect(h.endpoints.length).toBe(0);
  } finally { await h.controller.end(); }
});
test('late source confirmation cannot dismiss a newer requirement or survive the voice lifecycle', async () => {
  let acknowledge: ((result: { confirmed: boolean }) => void) | undefined; let sentSignal: AbortSignal | undefined;
  const h = harness({ confirmSourceContext: async (_id, _confirmation, signal) => new Promise(resolve => { acknowledge = resolve; sentSignal = signal; }) });
  const changed = { ...sourceRequirement, context: { context_key: 'replaced-context', target } };
  try {
    await h.controller.start(binding); presentSource(h); const pending = h.controller.confirmSourceContext(sourceRequirement);
    h.sockets[0].event({ kind: 'source_context_changed', requirement: changed });
    expect(sentSignal?.aborted).toBe(true); acknowledge?.({ confirmed: true }); await pending;
    expect(h.controller.getSnapshot().sourceContextRequirement).toEqual(changed);
    await h.controller.end(); expect(h.controller.getSnapshot().sourceContextRequirement).toBeUndefined();
    await h.controller.start(binding);
    await rejectsSource(() => h.controller.confirmSourceContext(sourceRequirement)); expect(h.work.length).toBe(0);
  } finally { await h.controller.end(); }
});
test('explicit start attaches before sampling and uses independent foreground and input credits', async () => {
  const h = harness(); await h.controller.start(binding);
  expect(h.endpoints[0].captures).toEqual([true]); expect(h.controller.getSnapshot().workRunning).toBe(true);
  expect(JSON.parse(h.sockets[0].sent[0] as string)).toEqual({ kind: 'foreground', activation_epoch: 1, sequence: 1 });
  h.endpoints[0].input(0); h.sockets[0].event({ kind: 'input_admitted', activation_epoch: 1, sequence: 0, duration_us: 20000 });
  h.endpoints[0].input(1);
  expect(h.sockets[0].sent.filter(value => value instanceof ArrayBuffer).length).toBe(2);
  expect(h.work.length).toBe(0); await h.controller.end(); expect(h.endpoints[0].closed).toBe(true);
});
test('mic pause and local stop-speech never cancel work and mute resumes only after the server control', async () => {
  const h = harness(); await h.controller.start(binding);
  await h.controller.microphone(); expect(h.endpoints[0].captures).toEqual([true, false]);
  await h.controller.stopSpeaking(); expect(h.endpoints[0].flushes).toEqual([2]);
  expect(h.controls.map(control => control.kind)).toEqual(['mute_input', 'interrupt_output']);
  expect(h.controller.getSnapshot().workRunning).toBe(true); expect(h.work.length).toBe(0);
  await h.controller.microphone(); expect(h.endpoints[0].captures).toEqual([true, false, true]); await h.controller.end();
});
test('paused in-flight audio returns credit without claiming admission or closing the voice lease', async () => {
  const h = harness(); await h.controller.start(binding);
  h.endpoints[0].input(0); h.endpoints[0].input(1);
  await h.controller.microphone();
  for (const sequence of [0, 1]) h.sockets[0].event({ kind: 'input_released', activation_epoch: 1, sequence, duration_us: 20000 });
  expect(h.endpoints[0].returnedCredits).toEqual([[0, 20000], [1, 20000]]);
  expect(h.controller.getDiagnostics().input_admission_ack.samples).toBe(0);
  h.advanceClock(250); await new Promise(resolve => setTimeout(resolve, 60));
  expect(h.controller.getSnapshot().connection).toBe('ready'); expect(h.controller.getSnapshot().microphone).toBe('paused');
  expect(h.sockets[0].closed).toBe(false); expect(h.controls.some(control => control.kind === 'close')).toBe(false); expect(h.work.length).toBe(0);
  await h.controller.microphone(); h.endpoints[0].input(2);
  h.sockets[0].event({ kind: 'input_admitted', activation_epoch: 1, sequence: 2, duration_us: 20000 });
  expect(h.controller.getDiagnostics().input_admission_ack.samples).toBe(1);
  await h.controller.end();
});
test('a long Relay recovery stops sampling and resumes only after a matching unmute acknowledgement', async () => {
  let acknowledge: ((state: VoiceActivation['state']) => void) | undefined;
  const controls: VoiceControl[] = [];
  const h = harness({ control: async (id, epoch, control) => {
    controls.push(control);
    if (control.kind === 'mute_input' && !control.muted) return new Promise(resolve => { acknowledge = resolve; });
    return { ...activation(epoch).state, voice_session_id: id, capture: 'paused' };
  } });
  try {
    await h.controller.start(binding); h.endpoints[0].input(0);
    h.sockets[0].event({ kind: 'state', state: { ...activation().state, connection: 'recovering', capture: 'paused', output_generation: 2 } });
    h.sockets[0].event({ kind: 'model', event: { kind: 'relay_recovering', output_generation: 2 } });
    h.sockets[0].event({ kind: 'input_released', activation_epoch: 1, sequence: 0, duration_us: 20000 });
    h.endpoints[0].input(1); h.advanceClock(20000); await new Promise(resolve => setTimeout(resolve, 60));
    expect(h.controller.getSnapshot().connection).toBe('recovering'); expect(h.controller.getSnapshot().microphone).toBe('paused');
    expect(h.endpoints[0].captures).toEqual([true, false]); expect(h.sockets[0].sent.filter(item => item instanceof ArrayBuffer).length).toBe(1);
    h.sockets[0].event({ kind: 'state', state: { ...activation().state, capture: 'paused', output_generation: 2 } });
    h.sockets[0].event({ kind: 'model', event: { kind: 'relay_recovered', output_generation: 2 } });
    expect(controls.at(-1)).toEqual({ kind: 'mute_input', muted: false }); expect(h.endpoints[0].captures).toEqual([true, false]);
    acknowledge?.({ ...activation().state, capture: 'capturing', output_generation: 2 });
    for (let turn = 0; turn < 10; turn++) await Promise.resolve();
    expect(h.endpoints[0].captures).toEqual([true, false, true]); expect(h.controller.getSnapshot().microphone).toBe('capturing');
    h.endpoints[0].input(2); h.sockets[0].event({ kind: 'input_admitted', activation_epoch: 1, sequence: 2, duration_us: 20000 });
    expect(h.sockets[0].sent.filter(item => item instanceof ArrayBuffer).length).toBe(2); expect(h.work.length).toBe(0);
  } finally { await h.controller.end(); }
});
test('pausing during recovery keeps capture stopped after the model has recovered', async () => {
  const h = harness();
  try {
    await h.controller.start(binding);
    h.sockets[0].event({ kind: 'state', state: { ...activation().state, connection: 'recovering', capture: 'paused', output_generation: 2 } });
    h.sockets[0].event({ kind: 'model', event: { kind: 'relay_recovering', output_generation: 2 } });
    await h.controller.microphone(); expect(h.controller.wantsMicrophone()).toBe(false);
    h.sockets[0].event({ kind: 'state', state: { ...activation().state, capture: 'paused', output_generation: 2 } });
    h.sockets[0].event({ kind: 'model', event: { kind: 'relay_recovered', output_generation: 2 } });
    for (let turn = 0; turn < 10; turn++) await Promise.resolve();
    expect(h.controller.getSnapshot().microphone).toBe('paused'); expect(h.endpoints[0].captures.filter(Boolean)).toEqual([true]);
    expect(h.controls).toEqual([{ kind: 'mute_input', muted: true }]); expect(h.work.length).toBe(0);
  } finally { await h.controller.end(); }
});
test('late Relay unmute acknowledgements cannot reopen capture after pause, a new recovery, background or end', async () => {
  for (const action of ['pause', 'recover', 'background', 'end']) {
    let acknowledge: ((state: VoiceActivation['state']) => void) | undefined;
    const h = harness({ control: async (_id, epoch, control) => control.kind === 'mute_input' && !control.muted
      ? new Promise(resolve => { acknowledge = resolve; }) : { ...activation(epoch).state, capture: 'paused' } });
    try {
      await h.controller.start(binding);
      h.sockets[0].event({ kind: 'state', state: { ...activation().state, connection: 'recovering', capture: 'paused', output_generation: 2 } });
      h.sockets[0].event({ kind: 'model', event: { kind: 'relay_recovering', output_generation: 2 } });
      h.sockets[0].event({ kind: 'state', state: { ...activation().state, capture: 'paused', output_generation: 2 } });
      h.sockets[0].event({ kind: 'model', event: { kind: 'relay_recovered', output_generation: 2 } });
      expect(acknowledge).toBeDefined();
      if (action === 'pause') await h.controller.microphone();
      if (action === 'recover') h.sockets[0].event({ kind: 'state', state: { ...activation().state, connection: 'recovering', capture: 'paused', output_generation: 3 } });
      if (action === 'background') h.background();
      if (action === 'end') await h.controller.end();
      acknowledge?.({ ...activation().state, capture: 'capturing', output_generation: 2 });
      for (let turn = 0; turn < 10; turn++) await Promise.resolve();
      expect(h.endpoints[0].captures.filter(Boolean)).toEqual([true]); expect(h.controller.getSnapshot().microphone === 'capturing').toBe(false);
      expect(h.work.length).toBe(0);
    } finally { await h.controller.end(); }
  }
});
test('RN without bufferedAmount fails closed when unacknowledged input exceeds negotiated duration', async () => {
  const h = harness(); await h.controller.start(binding);
  for (let sequence = 0; sequence < 4; sequence++) h.endpoints[0].input(sequence);
  await h.controller.end(); expect(h.sockets[0].closed).toBe(true); expect(h.endpoints[0].closed).toBe(true);
  expect(h.controller.getSnapshot().error).toContain('backlog'); expect(h.work.length).toBe(0);
});
test('future generation captions and NFV frames cannot advance the output fence', async () => {
  const h = harness(); await h.controller.start(binding);
  const segment = { segment_id: 'supplier-segment', response_id: 'response', revision: 1, output_generation: 2, text: 'future' };
  h.sockets[0].event({ kind: 'model', event: { kind: 'output_started', segment } });
  h.sockets[0].onmessage?.({ data: encodePacket({ activation_epoch: 1, output_generation: 2, sequence: 0, timestamp: 0, duration_us: 20000,
    format: spec.format, segment_id: segment.segment_id }, new ArrayBuffer(640)) });
  expect(h.controller.getSnapshot().captions.length).toBe(0); expect(h.endpoints[0].played).toBe(0);
  h.sockets[0].event({ kind: 'model', event: { kind: 'output_started', segment: { ...segment, output_generation: 1, text: 'current' } } });
  h.sockets[0].onmessage?.({ data: encodePacket({ activation_epoch: 1, output_generation: 1, sequence: 0, timestamp: 0, duration_us: 20000,
    format: spec.format, segment_id: segment.segment_id }, new ArrayBuffer(640)) });
  expect(h.endpoints[0].played).toBe(1); await h.controller.end();
});
test('source-message revocation clears unrelated supplier unplayed captions but keeps played facts and user text', async () => {
  const h = harness(); await h.controller.start(binding);
  h.sockets[0].event({ kind: 'model', event: { kind: 'transcript', fragment: { speaker: 'user', fragment_id: 'user', revision: 1, commit: 'committed', text: 'Correct this' } } });
  for (const id of ['played', 'unplayed']) h.sockets[0].event({ kind: 'model', event: { kind: 'output_started', segment: {
    segment_id: id, response_id: 'response', revision: 1, output_generation: 1, text: id, correlation_id: 'canonical-source' } } });
  h.endpoints[0].callbacks.playback({ segment_id: 'played', revision: 1, output_generation: 1, consumed_us: 10000, uncertain_tail_us: 1000, precision: 'estimated', finished: false });
  h.sockets[0].event({ kind: 'speech_revoked', source_message_id: 'canonical-source', source_revision: 2, output_generation: 2 });
  expect(h.endpoints[0].flushes).toEqual([2]); expect(h.controller.getSnapshot().captions.map(value => value.text)).toEqual(['Correct this', '']);
  expect(h.controller.getSnapshot().captions[1]).toMatchObject({ revoked: true, consumedUs: 10000, playbackPrecision: 'estimated' }); await h.controller.end();
});
test('local interruption and newer state remove old speech text while keeping user text and consumption facts', async () => {
  const h = harness(); await h.controller.start(binding);
  h.sockets[0].event({ kind: 'model', event: { kind: 'transcript', fragment: { speaker: 'user', fragment_id: 'user', revision: 1, commit: 'committed', text: 'Stop speaking' } } });
  for (const id of ['consumed', 'unplayed']) h.sockets[0].event({ kind: 'model', event: { kind: 'output_started', segment: {
    segment_id: id, response_id: 'response', revision: 1, output_generation: 1, text: `Full ${id} sentence` } } });
  h.endpoints[0].callbacks.playback({ segment_id: 'consumed', revision: 1, output_generation: 1, consumed_us: 8000, uncertain_tail_us: 2000, precision: 'estimated', finished: false });
  await h.controller.stopSpeaking();
  expect(h.controller.getSnapshot().captions.map(item => item.text)).toEqual(['Stop speaking', '']);
  expect(h.controller.getSnapshot().captions[1]).toMatchObject({ revoked: true, consumedUs: 8000, playbackPrecision: 'estimated' });
  h.sockets[0].event({ kind: 'model', event: { kind: 'output_started', segment: { segment_id: 'next', response_id: 'next-response', revision: 1, output_generation: 2, text: 'Next sentence' } } });
  h.sockets[0].event({ kind: 'state', state: { ...activation().state, output_generation: 3 } });
  expect(h.controller.getSnapshot().captions.map(item => item.text)).toEqual(['Stop speaking', '']);
  expect(h.work.length).toBe(0); await h.controller.end();
});
test('server lease revoke and mobile background stop local media before any network close wait', async () => {
  const h = harness(); await h.controller.start(binding);
  h.sockets[0].event({ kind: 'endpoint_control', activation_epoch: 1, control: { kind: 'close', reason: 'lease_revoked' } });
  expect(h.endpoints[0].closed).toBe(true); expect(h.sockets[0].closed).toBe(true); expect(h.work.length).toBe(0);
  await h.controller.end();
  const next = harness(); await next.controller.start(binding); next.background();
  expect(next.endpoints[0].closed).toBe(true); await next.controller.end(); expect(next.work.length).toBe(0);
});
test('stop-work sends only the explicitly supplied displayed original target, never text cancel latest', async () => {
  const h = harness(); await h.controller.start(binding); await h.controller.work({ action: 'cancel', target });
  expect(h.work).toEqual([{ action: 'cancel', target }]); expect(h.controller.getSnapshot().lastReceipt?.status).toBe('accepted');
  expect(h.controller.getSnapshot().workRunning).toBe(true); await h.controller.end();
});
test('unsupported native RTC never opens an endpoint or silently changes the profile transport', async () => {
  const h = harness(); let rejected = false;
  try { await h.controller.start({ ...binding, transport: 'native_webrtc' }); } catch { rejected = true; }
  expect(rejected).toBe(true); expect(h.endpoints.length).toBe(0); expect(h.activations()).toBe(0);
});
test('a source revision replaces partially consumed text with a timing-only tombstone', async () => {
  const h = harness(); await h.controller.start(binding);
  const fragment = { speaker: 'assistant' as const, fragment_id: 'source', revision: 1, commit: 'committed' as const, text: 'Complete sentence that was only partially played' };
  h.sockets[0].event({ kind: 'model', event: { kind: 'transcript', fragment } });
  h.endpoints[0].callbacks.playback({ segment_id: 'source', revision: 1, output_generation: 1, consumed_us: 7000, uncertain_tail_us: 3000, precision: 'estimated', finished: false });
  h.sockets[0].event({ kind: 'model', event: { kind: 'transcript', fragment: { ...fragment, revision: 2, text: 'Revised source' } } });
  const captions = h.controller.getSnapshot().captions;
  expect(captions[0]).toMatchObject({ text: '', revoked: true, consumedUs: 7000, playbackPrecision: 'estimated' });
  expect(captions[1].text).toBe('Revised source'); expect(captions[1].consumedUs).toBeUndefined(); await h.controller.end();
});
test('native attachment rebuild preserves an explicitly paused microphone', async () => {
  const native = (epoch: number): VoiceActivation => ({ ...activation(epoch), negotiation: { capabilities: {}, native_attachment: {
    attachment_id: `attachment-${epoch}`, answer_sdp: 'opaque', safe_output_boundary: true } } });
  const h = harness({ activate: async () => native(1), attachment: async () => native(2) }, ['relay', 'native_webrtc']);
  await h.controller.start({ ...binding, transport: 'native_webrtc' }); await h.controller.microphone(); await h.controller.stopSpeaking();
  h.sockets[0].event({ kind: 'model', event: { kind: 'native_attachment_required', output_generation: 2 } });
  for (let turn = 0; turn < 30 && (h.endpoints.length < 2 || h.controller.getSnapshot().connection !== 'ready'); turn++) await Promise.resolve();
  expect(h.endpoints.length).toBe(2); expect(h.endpoints[1].captures).toEqual([false]);
  expect(h.controller.getSnapshot().microphone).toBe('paused'); expect(h.controls.at(-1)).toEqual({ kind: 'mute_input', muted: true });
  expect(h.work.length).toBe(0); await h.controller.end();
});
