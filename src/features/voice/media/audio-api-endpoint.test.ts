import { expect, test } from 'bun:test';
import { AudioApiEndpoint, type AudioApiSdk } from './audio-api-endpoint';
import type { AudioApiBuffer, AudioApiContext, AudioApiGain, AudioApiManager,
  AudioApiOutputTimestamp, AudioApiQueue, AudioApiRecorder, AudioApiResult } from './audio-api-sdk';
import type { AudioMetadata, MediaSpec, OutputSegment, VoiceNegotiation } from '../contracts';
import type { MediaCallbacks, PlaybackCursor } from './types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function turns() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
async function rejects(promise: Promise<unknown>, text?: string) {
  const outcome = await promise.then(() => undefined, error => error);
  expect(outcome).toBeInstanceOf(Error);
  if (text) expect(String(outcome)).toContain(text);
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Expected SDK port disposition did not arrive');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}
function spec(maxDuration = 100_000, maxAge = 1_000_000): MediaSpec {
  return { format: { encoding: 'pcm', sample_format: 'signed16_le', sample_rate: 16000, channels: 1 },
    timebase: 16000, min_frame_duration_us: 10000, max_frame_duration_us: 40000,
    max_frame_bytes: 1280, max_buffer_duration_us: maxDuration, max_frame_age_us: maxAge };
}
const success: AudioApiResult = { status: 'success' };
class Buffer implements AudioApiBuffer {
  private readonly channels: Float32Array[];
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(channel: number) { return this.channels[channel]; }
  copyToChannel(source: Float32Array, channel: number) { this.channels[channel].set(source); }
}
class Gain implements AudioApiGain {
  gain = { value: 1 }; disconnectCalls = 0;
  connect(destination: unknown) { return destination; }
  disconnect() { this.disconnectCalls++; }
}
class Queue implements AudioApiQueue {
  onBufferEnded: AudioApiQueue['onBufferEnded'];
  readonly enqueued: Array<{ id: string; buffer: AudioApiBuffer }> = [];
  clearCalls = 0; stopCalls = 0; startCalls = 0; disconnectCalls = 0;
  constructor(private readonly identity: number) {}
  enqueueBuffer(buffer: AudioApiBuffer) {
    const id = `queue-${this.identity}-buffer-${this.enqueued.length}`;
    this.enqueued.push({ id, buffer }); return id;
  }
  clearBuffers() { this.clearCalls++; }
  stop() { this.stopCalls++; }
  start() { this.startCalls++; }
  disconnect() { this.disconnectCalls++; }
  connect(destination: unknown) { return destination; }
  ended(id: string, last = false) { this.onBufferEnded?.({ bufferId: id, isLastBufferInQueue: last }); }
}
class Context implements AudioApiContext {
  currentTime = 0; state: AudioApiContext['state'] = 'running'; destination = {};
  timestamp: AudioApiOutputTimestamp = { timelineId: 1, contextTime: null, performanceTime: null, latency: null, precision: 'unknown' };
  readonly queues: Queue[] = []; readonly gains: Gain[] = [];
  readonly suspensions: Array<ReturnType<typeof deferred<void>>> = [];
  readonly resumptions: Array<ReturnType<typeof deferred<void>>> = [];
  readonly closures: Array<ReturnType<typeof deferred<void>>> = [];
  suspendCalls = 0; resumeCalls = 0; closeCalls = 0; closeError?: Error;
  constructor(readonly sampleRate: number) {}
  createGain() { const gain = new Gain(); this.gains.push(gain); return gain; }
  createBuffer(channels: number, frames: number, rate: number) { return new Buffer(channels, frames, rate); }
  createBufferQueueSource() { const queue = new Queue(this.queues.length); this.queues.push(queue); return queue; }
  getOutputTimestamp() { return { ...this.timestamp }; }
  async suspend() { this.suspendCalls++; await this.suspensions.shift()?.promise; this.state = 'suspended'; }
  async resume() { this.resumeCalls++; await this.resumptions.shift()?.promise; this.state = 'running'; }
  async close() { this.closeCalls++; if (this.closeError) throw this.closeError; await this.closures.shift()?.promise; this.state = 'closed'; }
}
type ReadyOptions = Parameters<AudioApiRecorder['onAudioReady']>[0];
type ReadyCallback = Parameters<AudioApiRecorder['onAudioReady']>[1];
class Recorder implements AudioApiRecorder {
  readonly registrations: Array<{ options: ReadyOptions; callback: ReadyCallback }> = [];
  readonly starts: Array<ReturnType<typeof deferred<AudioApiResult>>> = [];
  readonly stops: Array<ReturnType<typeof deferred<AudioApiResult>>> = [];
  readonly acknowledged: string[] = [];
  current?: ReadyCallback; error?: Parameters<AudioApiRecorder['onError']>[0];
  startCalls = 0; stopCalls = 0; active = false;
  onAudioReady(options: ReadyOptions, callback: ReadyCallback) {
    this.registrations.push({ options, callback }); this.current = callback; return success;
  }
  clearOnAudioReady() { this.current = undefined; }
  onError(callback: Parameters<AudioApiRecorder['onError']>[0]) { this.error = callback; }
  clearOnError() { this.error = undefined; }
  async start() {
    this.startCalls++; this.active = true;
    const result = await this.starts.shift()?.promise ?? success;
    if (result.status !== 'success') this.active = false;
    return result;
  }
  async stop() {
    this.stopCalls++;
    const result = await this.stops.shift()?.promise ?? success;
    if (result.status === 'success') this.active = false;
    return result;
  }
  acknowledgeBuffer(id: string) { this.acknowledged.push(id); }
  emit(id: string, callback = this.current) {
    const buffer = new Buffer(1, 320, 16000);
    buffer.getChannelData(0)[0] = -1; buffer.getChannelData(0)[1] = .5;
    callback?.({ buffer, numFrames: 320, when: 0, bufferId: id });
  }
}
type SystemName = Parameters<AudioApiManager['addSystemEventListener']>[0];
type SystemCallback = Parameters<AudioApiManager['addSystemEventListener']>[1];
class Manager implements AudioApiManager {
  readonly activity: boolean[] = [];
  readonly activating: Array<ReturnType<typeof deferred<void>>> = [];
  readonly listeners = new Map<SystemName, Set<SystemCallback>>();
  async requestRecordingPermissions() { return 'Granted' as const; }
  async checkRecordingPermissions() { return 'Granted' as const; }
  setAudioSessionOptions(_options: Parameters<AudioApiManager['setAudioSessionOptions']>[0]) {}
  async setAudioSessionActivity(active: boolean) { this.activity.push(active); if (active) await this.activating.shift()?.promise; }
  observeAudioInterruptions(_type: 'gainTransientExclusive' | false) {}
  activelyReclaimSession(_enabled: boolean) {}
  addSystemEventListener(name: SystemName, callback: SystemCallback) {
    const listeners = this.listeners.get(name) ?? new Set<SystemCallback>(); this.listeners.set(name, listeners); listeners.add(callback);
    return { remove: () => { listeners.delete(callback); } };
  }
}
function harness(input = spec(), output = spec(), options: { closeTimeoutMs?: number } = {}) {
  const manager = new Manager(), contexts: Context[] = [], recorders: Recorder[] = [];
  const nextStarts: Array<ReturnType<typeof deferred<AudioApiResult>>> = [];
  const captures: Array<{ metadata: Parameters<MediaCallbacks['capture']>[0]; payload: ArrayBuffer }> = [];
  const playback: PlaybackCursor[] = [], unavailable: string[] = [], foregroundListeners = new Set<(active: boolean) => void>();
  let foreground = true, now = 0;
  const sdk: AudioApiSdk = { AudioManager: manager,
    AudioContext: class extends Context { constructor(options: { sampleRate: number; foregroundOnly: true }) { super(options.sampleRate); contexts.push(this); } },
    AudioRecorder: class extends Recorder { constructor(_options: { foregroundOnly: true; voiceProcessing: true }) {
      super(); this.starts.push(...nextStarts.splice(0)); recorders.push(this);
    } } };
  const endpoint = new AudioApiEndpoint({ capture: (metadata, payload) => captures.push({ metadata, payload }),
    playback: cursor => playback.push(cursor), unavailable: reason => unavailable.push(reason), level: () => {} },
  { sdk: () => sdk, foreground: () => foreground, now: () => now, pollMs: 1, ...options,
    onForegroundChange: listener => { foregroundListeners.add(listener); return () => { foregroundListeners.delete(listener); }; } });
  const negotiation: VoiceNegotiation = { capabilities: {}, input_spec: input, output_spec: output };
  return { endpoint, sdk, manager, contexts, recorders, nextStarts, captures, playback, unavailable, negotiation,
    get context() { return contexts[0]; }, get recorder() { return recorders[recorders.length - 1]; },
    now: (value: number) => { now = value; },
    foreground: (value: boolean) => { foreground = value; for (const listener of [...foregroundListeners]) listener(value); },
    async ready() { await endpoint.prepare('relay'); await endpoint.configure(negotiation, 1); await endpoint.startOutput(); } };
}
type Harness = ReturnType<typeof harness>;
function play(h: Harness, generation = 1, id = 'answer', sequence = 0) {
  const segment: OutputSegment = { segment_id: id, response_id: 'response', revision: 1, output_generation: generation, text: 'speech' };
  const metadata: AudioMetadata = { activation_epoch: 1, output_generation: generation, sequence, timestamp: sequence * 320,
    duration_us: 20000, format: h.negotiation.output_spec!.format, segment_id: id };
  h.endpoint.play(segment, metadata, new ArrayBuffer(640));
}

test('SDK mic pause stops the recorder while output remains independently usable', async () => {
  const h = harness();
  try {
    await h.ready(); await h.endpoint.capture(true); play(h);
    const queue = h.context.queues[0];
    await h.endpoint.capture(false);
    expect(h.recorder.active).toBe(false); expect(h.recorder.stopCalls).toBe(1);
    expect(h.context.state).toBe('running'); expect(queue.stopCalls).toBe(0); expect(queue.clearCalls).toBe(0);
    play(h, 1, 'continued-playback', 1); expect(queue.enqueued.length).toBe(2);
    const retired = h.recorder;
    await h.endpoint.capture(true); expect(h.recorder).not.toBe(retired);
    expect(retired.active).toBe(false); expect(h.recorder.startCalls).toBe(1);
  } finally { await h.endpoint.close(); }
});

test('SDK flush clears old output immediately and holds only current-generation audio until the actual suspend barrier', async () => {
  const h = harness(); const suspension = deferred<void>();
  try {
    await h.ready(); await h.endpoint.capture(true); await h.endpoint.capture(false); play(h, 1, 'old');
    const oldQueue = h.context.queues[0], lateRender = oldQueue.onBufferEnded;
    h.context.suspensions.push(suspension); h.endpoint.flush(2);
    expect(oldQueue.clearCalls).toBeGreaterThan(0); expect(oldQueue.stopCalls).toBeGreaterThan(0);
    play(h, 1, 'obsolete'); play(h, 3, 'unannounced-future'); play(h, 2, 'new-current');
    await turns(); expect(h.context.queues.length).toBe(1); expect(oldQueue.enqueued.length).toBe(1);
    suspension.resolve(); await until(() => h.context.queues.length === 2 && h.context.queues[1].enqueued.length === 1);
    expect(h.recorder.startCalls).toBe(1); expect(h.recorder.active).toBe(false);
    h.context.currentTime = 1; h.context.timestamp = { timelineId: 1, contextTime: 2, performanceTime: 0, latency: .01, precision: 'estimated' };
    lateRender?.({ bufferId: oldQueue.enqueued[0].id, isLastBufferInQueue: true });
    expect(h.playback.length).toBe(0);
  } finally { suspension.resolve(); await h.endpoint.close(); }
});

test('SDK output flush does not stop an independently active microphone', async () => {
  const h = harness();
  try {
    await h.ready(); await h.endpoint.capture(true); h.endpoint.flush(2);
    await until(() => h.context.queues.length === 2);
    expect(h.recorder.startCalls).toBe(1); expect(h.recorder.stopCalls).toBe(0);
    h.recorder.emit('still-capturing'); expect(h.captures.length).toBe(1);
  } finally { await h.endpoint.close(); }
});

test('SDK input permits bind the exact native buffer to one server sequence and duration disposition', async () => {
  const h = harness();
  try {
    await h.ready(); await h.endpoint.capture(true); h.recorder.emit('native-A'); h.recorder.emit('native-B');
    const [a, b] = h.captures; expect(a.payload.byteLength).toBe(640);
    expect(new DataView(a.payload).getInt16(0, true)).toBe(-32768); expect(new DataView(a.payload).getInt16(2, true)).toBe(16384);
    h.endpoint.returnInputCredit(99999, a.metadata.duration_us); expect(h.recorder.acknowledged).toEqual([]);
    h.endpoint.returnInputCredit(b.metadata.sequence, b.metadata.duration_us);
    h.endpoint.returnInputCredit(b.metadata.sequence, b.metadata.duration_us);
    expect(h.recorder.acknowledged).toEqual(['native-B']);
    h.endpoint.returnInputCredit(a.metadata.sequence, a.metadata.duration_us - 1);
    expect(h.recorder.acknowledged).toEqual(['native-B']); expect(h.unavailable).toEqual(['backlog']);
  } finally { await h.endpoint.close(); }
});

test('SDK callbacks and credit from an old capture epoch cannot publish or release a newer native buffer', async () => {
  const h = harness();
  try {
    await h.ready(); await h.endpoint.capture(true);
    const oldCallback = h.recorder.registrations[0].callback;
    h.recorder.emit('old-buffer'); const oldSequence = h.captures[0].metadata.sequence;
    await h.endpoint.capture(false); await h.endpoint.capture(true);
    h.recorder.emit('late-old-buffer', oldCallback); expect(h.captures.length).toBe(1);
    h.recorder.emit('new-buffer'); const current = h.captures[1].metadata;
    h.endpoint.returnInputCredit(oldSequence, 20000); expect(h.recorder.acknowledged).toEqual([]);
    h.endpoint.returnInputCredit(current.sequence, current.duration_us); expect(h.recorder.acknowledged).toEqual(['new-buffer']);
  } finally { await h.endpoint.close(); }
});

test('SDK options receive native admission bounds and the TS port separately rejects a violating duration producer', async () => {
  const h = harness(spec(40000, 50000));
  try {
    await h.ready(); await h.endpoint.capture(true);
    expect(h.recorder.registrations[0].options).toMatchObject({ maxPendingDurationUs: 40000, maxPendingAgeUs: 50000 });
    // The fake deliberately does not enforce native limits. This proves the
    // port's second guard, never the actual patched SDK's native behavior.
    h.recorder.emit('A'); h.recorder.emit('B'); h.recorder.emit('over-budget');
    expect(h.captures.length).toBe(2); expect(h.unavailable).toEqual(['backlog']);
  } finally { await h.endpoint.close(); }
});

test('SDK unacknowledged input age is checked by the TS port before another frame can upload', async () => {
  const h = harness(spec(100000, 50000));
  try {
    await h.ready(); await h.endpoint.capture(true); h.recorder.emit('unacknowledged');
    h.now(51); h.recorder.emit('later-frame');
    expect(h.captures.length).toBe(1); expect(h.unavailable).toEqual(['backlog']);
  } finally { await h.endpoint.close(); }
});

test('SDK holding output remains duration-bounded while suspension is pending', async () => {
  const h = harness(spec(), spec(40000)); const suspension = deferred<void>();
  try {
    await h.ready(); h.context.suspensions.push(suspension); h.endpoint.flush(2);
    play(h, 2, 'held', 0); play(h, 2, 'held', 1); play(h, 2, 'over-budget', 2);
    expect(h.unavailable).toEqual(['backlog']); expect(h.context.queues[0].enqueued.length).toBe(0);
    suspension.resolve(); await h.endpoint.close();
    expect(h.context.queues.every(queue => queue.enqueued.length === 0)).toBe(true);
  } finally { suspension.resolve(); await h.endpoint.close(); }
});

test('SDK resume rechecks holding age before enqueue, even when the timer has not polled', async () => {
  const h = harness(spec(), spec(100000, 50000)); const suspension = deferred<void>();
  try {
    await h.ready(); h.context.suspensions.push(suspension); h.endpoint.flush(2); play(h, 2, 'expired-held');
    h.now(51); suspension.resolve(); await turns();
    expect(h.context.queues.every(queue => queue.enqueued.length === 0)).toBe(true);
    await until(() => h.unavailable.length > 0); expect(h.unavailable).toEqual(['backlog']);
  } finally { suspension.resolve(); await h.endpoint.close(); }
});

test('SDK played facts require both mapped render completion and an actual sink timestamp, never elapsed wall time', async () => {
  const h = harness();
  try {
    await h.ready(); for (let i = 0; i < 3; i++) play(h, 1, 'answer', i);
    const queue = h.context.queues[0]; h.context.currentTime = 10;
    h.context.timestamp = { timelineId: 1, contextTime: 10, performanceTime: 0, latency: .03, precision: 'estimated' };
    h.now(500); await new Promise(resolve => setTimeout(resolve, 5));
    expect(h.playback.length).toBe(0); // Sink time cannot prove an unmapped buffer rendered.
    h.context.timestamp = { timelineId: 1, contextTime: null, performanceTime: null, latency: null, precision: 'unknown' };
    queue.ended(queue.enqueued[0].id); expect(h.playback.length).toBe(0);
    h.context.timestamp = { timelineId: 1, contextTime: 9.9, performanceTime: 0, latency: .03, precision: 'estimated' };
    await new Promise(resolve => setTimeout(resolve, 5)); expect(h.playback.length).toBe(0);
    h.context.currentTime = 11; h.context.timestamp.contextTime = 11; await until(() => h.playback.length === 1);
    expect(h.playback[0]).toMatchObject({ segment_id: 'answer', revision: 1, output_generation: 1,
      consumed_us: 20000, precision: 'estimated', finished: false });
    expect(h.playback[0].uncertain_tail_us).toBeGreaterThan(0);
    expect(h.playback[0].consumed_us).toBe(20000); // Two other enqueued buffers remain unproved.
    h.context.currentTime = 12; queue.ended(queue.enqueued[1].id);
    expect(h.playback.length).toBe(1);
    h.context.timestamp.contextTime = 12; await until(() => h.playback.length === 2);
    expect(h.playback[1].consumed_us).toBe(40000);
  } finally { await h.endpoint.close(); }
});

test('SDK sink discontinuity cannot turn an old rendered tail into a new fully played receipt', async () => {
  const h = harness();
  try {
    await h.ready(); play(h);
    h.context.currentTime = .02;
    h.context.timestamp = { timelineId: 1, contextTime: .01, performanceTime: 0, latency: .01, precision: 'estimated' };
    h.context.queues[0].ended(h.context.queues[0].enqueued[0].id);
    expect(h.playback).toEqual([]);
    // A native driver reset has skipped an uncertain queued tail; its new
    // clock may jump ahead, but it cannot attest old-timeline speaker output.
    h.context.timestamp = { timelineId: 2, contextTime: 100, performanceTime: 0, latency: .01, precision: 'estimated' };
    await new Promise(resolve => setTimeout(resolve, 5)); expect(h.playback).toEqual([]);
    play(h, 1, 'new-timeline', 1); h.context.currentTime = 100;
    h.context.queues[0].ended(h.context.queues[0].enqueued[1].id);
    expect(h.playback).toHaveLength(1); expect(h.playback[0].segment_id).toBe('new-timeline');
  } finally { await h.endpoint.close(); }
});

test('SDK foreground loss stops local media and foreground return never automatically reopens the microphone', async () => {
  const h = harness();
  try {
    await h.ready(); await h.endpoint.capture(true); play(h);
    const lateCallback = h.recorder.registrations[0].callback;
    h.foreground(false); expect(h.unavailable).toEqual(['device_unavailable']);
    expect(h.context.queues[0].clearCalls).toBeGreaterThan(0);
    await h.endpoint.close(); h.foreground(true); h.recorder.emit('late-foreground', lateCallback);
    expect(h.recorder.active).toBe(false); expect(h.recorder.startCalls).toBe(1); expect(h.captures.length).toBe(0);
    await rejects(h.endpoint.capture(true));
  } finally { await h.endpoint.close(); }
});

test('SDK close during configuration cancels admission and releases the partially activated session', async () => {
  const h = harness(); const activation = deferred<void>(); h.manager.activating.push(activation);
  await h.endpoint.prepare('relay');
  const configuration = h.endpoint.configure(h.negotiation, 1).then(() => undefined, error => error);
  try {
    await until(() => h.manager.activity.includes(true)); const closing = h.endpoint.close();
    activation.resolve(); expect(await configuration).toBeInstanceOf(Error); await closing;
    expect(h.contexts.length).toBe(0); expect(h.recorders.length).toBe(0); expect(h.manager.activity).toContain(false);
  } finally { activation.resolve(); await h.endpoint.close(); }
});

test('SDK close first requests stop during a pending microphone start and fences its late acknowledgement and callbacks', async () => {
  const h = harness(); const start = deferred<AudioApiResult>();
  try {
    await h.ready(); h.nextStarts.push(start);
    const capturing = h.endpoint.capture(true).then(() => undefined, error => error);
    await until(() => h.recorder?.startCalls === 1); const callback = h.recorder.registrations[0].callback;
    const closing = h.endpoint.close(); await turns();
    expect(h.recorder.stopCalls).toBeGreaterThan(0); expect(h.context.queues[0].clearCalls).toBeGreaterThan(0);
    h.recorder.emit('start-race', callback); expect(h.captures.length).toBe(0);
    start.resolve(success); await capturing; await closing;
    expect(h.recorder.active).toBe(false); expect(h.recorder.startCalls).toBe(1); expect(h.context.state).toBe('closed');
  } finally { start.resolve(success); await h.endpoint.close(); }
});

test('SDK close waits for an in-flight output suspension while stopping the sink immediately', async () => {
  const h = harness(); const suspension = deferred<void>();
  try {
    await h.ready(); play(h); const queue = h.context.queues[0];
    h.context.suspensions.push(suspension); h.endpoint.flush(2); await turns();
    let settled = false; const closing = h.endpoint.close().then(() => { settled = true; });
    await turns(); expect(queue.clearCalls).toBeGreaterThan(0); expect(queue.stopCalls).toBeGreaterThan(0);
    expect(settled).toBe(false); expect(h.context.closeCalls).toBe(0);
    suspension.resolve(); await closing; expect(h.context.state).toBe('closed');
  } finally { suspension.resolve(); await h.endpoint.close(); }
});

test('SDK close timeout keeps ownership until real cleanup finishes and only then permits a new explicit endpoint', async () => {
  const h = harness(spec(), spec(), { closeTimeoutMs: 10 }); const completion = deferred<void>();
  try {
    await h.ready(); h.context.closures.push(completion);
    await rejects(h.endpoint.close(), 'unconfirmed');
    expect(h.context.closeCalls).toBe(1); expect(h.context.state).not.toBe('closed');
    expect(h.manager.activity).not.toContain(false);
    const refused = harness(); await refused.endpoint.prepare('relay');
    await rejects(refused.endpoint.configure(refused.negotiation, 1), 'cleanup is unconfirmed');
    expect(refused.contexts.length).toBe(0); await refused.endpoint.close();
    completion.resolve(); await until(() => h.manager.activity.includes(false)); await turns();
    expect(h.context.state).toBe('closed'); expect(h.context.closeCalls).toBe(1);
    const admitted = harness();
    try { await admitted.ready(); expect(admitted.contexts.length).toBe(1); }
    finally { await admitted.endpoint.close(); }
  } finally {
    completion.resolve(); await h.endpoint.close().catch(() => {});
    await until(() => h.manager.activity.includes(false)); await turns();
  }
});

// Keep this terminal ownership case last: the real public owner intentionally
// remains fenced after unknown SDK cleanup. No private test reset invents proof.
test('SDK unknown cleanup rejects close and cannot be converted into success by configuring another endpoint', async () => {
  const h = harness(); await h.ready(); h.context.closeError = new Error('SDK close is unconfirmed');
  await rejects(h.endpoint.close(), 'unconfirmed');
  const next = harness(); await next.endpoint.prepare('relay');
  await rejects(next.endpoint.configure(next.negotiation, 1), 'cleanup is unconfirmed');
  expect(next.contexts.length).toBe(0); expect(next.recorders.length).toBe(0); await next.endpoint.close();
});
