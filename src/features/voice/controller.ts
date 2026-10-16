import type { AudioMetadata, Availability, OutputSegment, PlaybackReceipt, ProductEvent, TranscriptFragment,
  VoiceActivation, VoiceBinding, VoiceControl, VoiceProjection, VoiceState, WorkReceipt, ApprovalPresentation, WorkRequest,
  SourceContextConfirmation, SourceContextRequirement } from './contracts';
import type { VoiceCloseReason } from './contracts.generated';
import type { EndpointFactory, VoiceMediaEndpoint, PlaybackCursor, DeviceSettings } from './media/types';
import { InputCredits } from './media/credits';
import { decodePacket, encodePacket, validateAudio } from './media/codec';
import { VoiceDiagnostics } from './diagnostics';

export interface MediaSocket { readyState: number; bufferedAmount?: number; binaryType: string; onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null; onclose: (() => void) | null; onerror: (() => void) | null;
  send(data: ArrayBuffer | string): void; close(): void }
export interface VoiceAPI { availability(session: string, signal?: AbortSignal): Promise<Availability>;
  activate(binding: VoiceBinding, endpoint: string, offer: string | undefined, takeover: boolean): Promise<VoiceActivation>;
  control(id: string, epoch: number, control: VoiceControl, signal?: AbortSignal): Promise<VoiceState>;
  attachment(id: string, epoch: number, offer: string): Promise<VoiceActivation>;
  projection(id: string, epoch: number, signal: AbortSignal): Promise<VoiceProjection>;
  confirmSourceContext(id: string, confirmation: SourceContextConfirmation, signal: AbortSignal): Promise<{ confirmed: boolean }>;
  work?(id: string, epoch: number, request: WorkRequest, operationKey: string): Promise<WorkReceipt> }
export interface Caption { id: string; speaker: 'user' | 'assistant'; text: string; revision: number; committed: boolean;
  outputGeneration?: number; consumedUs?: number; playbackPrecision?: PlaybackReceipt['precision']; revoked?: boolean; timingOnly?: boolean }
export interface VoiceSnapshot { role: 'inactive' | 'active' | 'observer'; binding?: VoiceBinding;
  connection: 'inactive' | 'opening' | 'ready' | 'recovering' | 'closing' | 'closed' | 'failed';
  microphone: 'off' | 'capturing' | 'paused' | 'unavailable'; playback: 'quiet' | 'queued' | 'playing' | 'interrupted' | 'native';
  workRunning: boolean; captions: Caption[]; approvals: ApprovalPresentation[]; lastReceipt?: WorkReceipt;
  sourceContextRequirement?: SourceContextRequirement;
  error?: string; device?: DeviceSettings; level: number; bufferedUs: number }
export interface ControllerDependencies { api: VoiceAPI; endpoints: EndpointFactory; socket(id: string, ticket: string): MediaSocket;
  now(): number; identity(): string; foreground?(): boolean }
const message = (error: unknown) => (error instanceof Error ? error.message : 'Voice unavailable')
  .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/(?:sk-|nomifun\.voice\.ticket\.)[\w.-]+/gi, '[redacted]').slice(0, 280);

/** Thin interaction owner. Never sends a text turn, executes tools or decides
 * work completion. Only typed Desktop receipts can change work facts. */
export class VoiceController {
  private snapshot: VoiceSnapshot = { role: 'inactive', connection: 'inactive', microphone: 'off', playback: 'quiet',
    workRunning: false, captions: [], approvals: [], level: 0, bufferedUs: 0 };
  private listeners = new Set<() => void>();
  private operation = 0;
  private activation?: VoiceActivation;
  private endpoint?: VoiceMediaEndpoint;
  private socket?: MediaSocket;
  private credits?: InputCredits;
  private watchdog?: ReturnType<typeof setInterval>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private heartbeatSequence = 0;
  private generation = 0;
  private ready = false;
  private microphoneWanted = false;
  private microphoneRevision = 0;
  private relayRecovery = false;
  private segments = new Map<string, OutputSegment>();
  private outputStarted = new Map<string, number>();
  private outputReported = new Set<string>();
  private readonly diagnostics = new VoiceDiagnostics();
  private localVolume = 1;
  private receipts = new Map<string, PlaybackReceipt>();
  private receiptTail: Promise<void> = Promise.resolve();
  private receiptQueue = new Map<string, PlaybackReceipt>();
  private receiptWriting = false;
  private receiptWriter?: VoiceActivation;
  private ending?: Promise<void>;
  private observation?: { id: string; epoch: number; abort: AbortController; timer?: ReturnType<typeof setTimeout> };
  private closeObservation?: AbortController;
  private sourceContextRevision = 0;
  private sourceContextAbort?: AbortController;
  private readonly endpointId: string;
  constructor(private readonly deps: ControllerDependencies) { this.endpointId = deps.identity(); }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  getDiagnostics = () => this.diagnostics.report();
  wantsMicrophone = () => this.microphoneWanted;
  private update(patch: Partial<VoiceSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; for (const listener of this.listeners) listener(); }
  async start(binding: VoiceBinding, takeover = false): Promise<void> {
    if (['opening', 'ready', 'recovering', 'closing'].includes(this.snapshot.connection) && this.snapshot.role === 'active') throw new Error('End the bound voice before moving it');
    if (!this.deps.endpoints.transports.includes(binding.transport)) throw new Error('This device does not support the selected transport');
    this.stopObservation(); this.closeObservation?.abort(); const operation = ++this.operation;
    this.setSourceContextRequirement(undefined);
    this.microphoneWanted = true; ++this.microphoneRevision; this.relayRecovery = false;
    this.segments.clear(); this.outputStarted.clear(); this.outputReported.clear(); this.receipts.clear(); this.receiptQueue.clear(); this.receiptTail = Promise.resolve(); this.receiptWriting = false; this.ready = false;
    this.update({ role: 'active', binding, connection: 'opening', microphone: 'off', playback: 'quiet', error: undefined, captions: [], approvals: [], level: 0 });
    const endpoint = this.deps.endpoints.create({ capture: (metadata, payload) => this.capture(operation, metadata, payload),
      playback: cursor => this.played(operation, cursor), unavailable: reason => { if (operation === this.operation) void this.end(reason as VoiceCloseReason); },
      level: level => { if (operation === this.operation && this.snapshot.microphone === 'capturing') this.update({ level }); } });
    this.endpoint = endpoint;
    try {
      const offer = await endpoint.prepare(binding.transport, binding.native_requirements ?? undefined);
      if (operation !== this.operation) { await endpoint.close(); return; }
      const activation = await this.deps.api.activate(binding, this.endpointId, offer, takeover);
      if (operation !== this.operation) { await this.deps.api.control(activation.voice_session_id, activation.activation_epoch, { kind: 'close', reason: 'user_ended' }); return; }
      this.activation = activation; this.receiptWriter = activation; this.generation = activation.state.output_generation;
      const device = await endpoint.configure(activation.negotiation, this.generation);
      endpoint.volume(this.localVolume);
      if (operation !== this.operation) return;
      await this.connect(activation, operation);
      if (operation !== this.operation) return;
      await endpoint.startOutput?.();
      this.ready = !this.relayRecovery; this.update({ device, connection: this.relayRecovery ? 'recovering' : 'ready', workRunning: activation.state.work_running });
      if (this.ready && this.microphoneWanted && this.isForeground()) {
        await endpoint.capture(true);
        if (operation === this.operation && this.ready && this.microphoneWanted) this.update({ microphone: 'capturing' });
      }
    } catch (error) { if (operation === this.operation) { await this.end('provider_failed'); this.update({ connection: 'failed', error: message(error) }); } }
  }
  private async connect(activation: VoiceActivation, operation: number): Promise<void> {
    const socket = this.deps.socket(activation.voice_session_id, activation.attachment_token); this.socket = socket; socket.binaryType = 'arraybuffer';
    const spec = activation.negotiation.input_spec;
    if (spec) this.credits = new InputCredits(Math.min(200000, spec.max_buffer_duration_us), Math.min(200000, spec.max_frame_age_us), this.deps.now);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Voice attachment deadline')), 12000);
      socket.onopen = () => { clearTimeout(timeout); resolve(); };
      socket.onerror = () => { clearTimeout(timeout); reject(new Error('Voice media unavailable')); };
      socket.onclose = () => { clearTimeout(timeout); reject(new Error('Voice media closed')); if (operation === this.operation) void this.end('network_lost'); };
      socket.onmessage = event => {
        if (this.activation !== activation || operation !== this.operation) return;
        try {
          if (event.data instanceof ArrayBuffer) { const frame = decodePacket(event.data); this.audio(frame.metadata, frame.payload); }
          else this.event(JSON.parse(String(event.data)) as ProductEvent);
        } catch (error) { void this.end('provider_failed').then(() => this.update({ error: message(error) })); }
      };
      if (socket.readyState === 1) socket.onopen();
    });
    clearInterval(this.watchdog); this.watchdog = setInterval(() => { try { this.credits?.checkAge(); } catch (error) {
      void this.end('backlog').then(() => this.update({ error: message(error) }));
    } }, 40);
    this.heartbeatSequence = 0;
    const heartbeat = () => {
      if (this.activation !== activation || operation !== this.operation || socket.readyState !== 1) return;
      if (this.deps.foreground?.() === false || this.endpoint?.foreground?.() === false) { this.background(); return; }
      socket.send(JSON.stringify({ kind: 'foreground', activation_epoch: activation.activation_epoch, sequence: ++this.heartbeatSequence }));
    };
    heartbeat(); this.heartbeat = setInterval(heartbeat, 1000);
  }
  private capture(operation: number, metadata: Omit<AudioMetadata, 'activation_epoch' | 'output_generation'>, payload: ArrayBuffer): void {
    const activation = this.activation, spec = activation?.negotiation.input_spec;
    if (operation !== this.operation || !this.ready || !activation || !spec || this.socket?.readyState !== 1 || this.snapshot.microphone !== 'capturing') return;
    try {
      const frame = { ...metadata, activation_epoch: activation.activation_epoch, output_generation: this.generation };
      validateAudio(frame, payload, spec); this.credits!.admit(frame.sequence, frame.duration_us);
      const buffered = this.socket.bufferedAmount;
      if (typeof buffered === 'number' && buffered / (spec.format.sample_rate * spec.format.channels * 2) * 1e6 > 200000) throw new Error('Voice transport backlog');
      this.socket.send(encodePacket(frame, payload));
      this.diagnostics.inputFrames++;
    } catch (error) { void this.end('backlog').then(() => this.update({ error: message(error) })); }
  }
  private audio(metadata: AudioMetadata, payload: ArrayBuffer): void {
    const activation = this.activation, spec = activation?.negotiation.output_spec;
    if (!activation || metadata.activation_epoch !== activation.activation_epoch || metadata.output_generation !== this.generation || !metadata.segment_id) return;
    if (!spec) throw new Error('Native attachment cannot duplicate relay output');
    const segment = this.segments.get(metadata.segment_id); if (!segment || segment.output_generation !== this.generation) return;
    validateAudio(metadata, payload, spec); this.endpoint?.play(segment, metadata, payload); this.update({ playback: 'queued' });
  }
  private event(product: ProductEvent): void {
    const activation = this.activation; if (!activation) return;
    if (product.kind === 'input_admitted' || product.kind === 'input_released') {
      if (product.activation_epoch === activation.activation_epoch) {
        const elapsed = this.credits?.acknowledge(product.sequence, product.duration_us);
        if (product.kind === 'input_admitted' && elapsed !== undefined) this.diagnostics.add(this.diagnostics.inputAckMs, elapsed);
        this.endpoint?.returnInputCredit?.(product.sequence, product.duration_us);
      }
      return;
    }
    if (product.kind === 'source_context_changed') { this.setSourceContextRequirement(product.requirement ?? undefined); return; }
    if (product.kind === 'work_receipt') { this.update({ lastReceipt: product.receipt }); return; }
    if (product.kind === 'approval_presented') { this.update({ approvals: [...this.snapshot.approvals.filter(item => item.target.presentation_id !== product.presentation.target.presentation_id), product.presentation].slice(-32) }); return; }
    if (product.kind === 'speech_revoked') {
      this.endpoint?.flush(product.output_generation);
      this.revokeBeforeGeneration(product.output_generation); this.update({ playback: 'interrupted' }); return;
    }
    if (product.kind === 'endpoint_control') {
      if (product.activation_epoch !== activation.activation_epoch) return;
      if (product.control.kind === 'close') { void this.closeFromServer(); return; }
      if (product.control.kind === 'interrupt_output' && product.control.output_generation > this.generation) {
        this.generation = product.control.output_generation; this.endpoint?.flush(this.generation);
        this.revokeBeforeGeneration(this.generation); this.update({ playback: 'interrupted' });
      } else if (product.control.kind === 'mute_input' && product.control.muted && this.snapshot.microphone !== 'paused') {
        this.update({ microphone: 'paused', level: 0 }); void this.endpoint?.capture(false);
      }
      return;
    }
    if (product.kind === 'state') {
      const state = product.state; if (state.voice_session_id !== activation.voice_session_id || state.activation_epoch !== activation.activation_epoch) return;
      if (state.output_generation > this.generation) { this.generation = state.output_generation; this.endpoint?.flush(this.generation); this.revokeBeforeGeneration(this.generation); }
      if (state.connection === 'recovering' && this.snapshot.binding?.transport === 'relay') this.pauseRelayCapture();
      this.update({ connection: state.connection, workRunning: state.work_running });
      if (['closing', 'closed', 'failed'].includes(state.connection)) void this.closeFromServer(); return;
    }
    const event = product.event;
    switch (event.kind) {
      case 'transcript': this.caption(event.fragment); break;
      case 'output_started':
        if (event.segment.output_generation !== this.generation) break;
        this.segments.set(event.segment.segment_id, event.segment); this.outputStarted.set(event.segment.segment_id, this.deps.now());
        if (this.segments.size > 256) { const oldest = this.segments.keys().next().value!; this.segments.delete(oldest); this.outputStarted.delete(oldest); this.outputReported.delete(oldest); }
        if (event.segment.text) this.caption({ speaker: 'assistant', fragment_id: event.segment.segment_id, revision: event.segment.revision, text: event.segment.text, commit: 'committed' }); break;
      case 'audio': this.audio({ ...event.frame, segment_id: event.segment_id }, new Uint8Array(event.frame.payload).buffer); break;
      case 'output_boundary':
        if (event.output_generation === this.generation && event.attachment_id === activation.negotiation.native_attachment?.attachment_id) void this.endpoint?.resumeNativeBoundary(event.attachment_id!); break;
      case 'native_attachment_required': if (event.output_generation === this.generation) void this.rebuild(); break;
      case 'relay_recovering': if (event.output_generation === this.generation && this.snapshot.binding?.transport === 'relay') this.pauseRelayCapture(); break;
      case 'relay_recovered':
        if (event.output_generation !== this.generation || !this.relayRecovery || this.snapshot.connection !== 'ready') break;
        this.relayRecovery = false; this.ready = true;
        if (this.microphoneWanted && this.isForeground()) void this.resumeRequestedCapture(activation, this.microphoneRevision); break;
      case 'closed': void this.closeFromServer(true, event.termination.finalization_confirmed); break;
      case 'error': void this.end('provider_failed').then(() => this.update({ error: message(new Error(event.error.message)) })); break;
      case 'control_rejected': this.update({ error: message(new Error(event.error.message)) }); break;
      default: break; // Model completion is not canonical work completion.
    }
  }
  private setSourceContextRequirement(requirement: SourceContextRequirement | undefined): void {
    ++this.sourceContextRevision; this.sourceContextAbort?.abort(); this.sourceContextAbort = undefined;
    this.update({ sourceContextRequirement: requirement });
  }
  sourceContextText(requirement: SourceContextRequirement): string | undefined {
    const scope = this.activation ?? this.observation;
    if (!scope) return;
    const voiceId = 'voice_session_id' in scope ? scope.voice_session_id : scope.id;
    const epoch = 'activation_epoch' in scope ? scope.activation_epoch : scope.epoch;
    return this.snapshot.captions.find(caption => caption.id === `${voiceId}:${epoch}:user:${requirement.source_ref.fragment_id}` &&
      caption.revision === requirement.source_ref.revision && caption.committed && caption.text.trim())?.text;
  }
  /** Called only by an explicit human gesture. Model events and observer polls
   * display a requirement, but never execute this authenticated HTTP action. */
  async confirmSourceContext(requirement: SourceContextRequirement): Promise<void> {
    const activation = this.activation, current = this.snapshot.sourceContextRequirement;
    if (!activation || this.snapshot.role !== 'active' || this.snapshot.connection !== 'ready' || !this.isForeground()) throw new Error('Active foreground voice is required for source confirmation');
    if (!current || current.source_ref.fragment_id !== requirement.source_ref.fragment_id || current.source_ref.revision !== requirement.source_ref.revision ||
      current.context.context_key !== requirement.context.context_key || !this.sourceContextText(requirement)) throw new Error('The displayed source confirmation is no longer current');
    const target = current.context.target;
    const displayedTarget = requirement.context.target;
    if (!target || !displayedTarget || target.agent_session_id !== displayedTarget.agent_session_id || target.binding_version !== displayedTarget.binding_version ||
      target.turn_operation_id !== displayedTarget.turn_operation_id || target.execution_generation !== displayedTarget.execution_generation) throw new Error('The displayed task target is no longer current');
    if (target.agent_session_id !== activation.state.agent_session_id || target.binding_version !== activation.state.binding_version) throw new Error('The source target is outside the bound voice conversation');
    const revision = this.sourceContextRevision, abort = new AbortController(); this.sourceContextAbort?.abort(); this.sourceContextAbort = abort;
    try {
      const result = await this.deps.api.confirmSourceContext(activation.voice_session_id, { activation_epoch: activation.activation_epoch,
        source_ref: { ...current.source_ref }, context_key: current.context.context_key }, abort.signal);
      if (this.activation !== activation || revision !== this.sourceContextRevision || abort.signal.aborted) return;
      if (!result.confirmed) throw new Error('Source target confirmation is unconfirmed');
      this.setSourceContextRequirement(undefined);
    } catch (error) { if (this.activation === activation && revision === this.sourceContextRevision && !abort.signal.aborted) throw error; }
    finally { if (this.sourceContextAbort === abort) this.sourceContextAbort = undefined; }
  }
  private isForeground(): boolean { return this.deps.foreground?.() !== false && this.endpoint?.foreground?.() !== false; }
  private pauseRelayCapture(): void {
    if (this.relayRecovery) return;
    ++this.microphoneRevision;
    this.relayRecovery = true; this.ready = false;
    this.update({ microphone: 'paused', level: 0 });
    const activation = this.activation, endpoint = this.endpoint;
    void endpoint?.capture(false).catch(error => {
      if (this.activation === activation && this.endpoint === endpoint) void this.end('device_unavailable').then(() => this.update({ error: message(error) }));
    });
  }
  private async resumeRequestedCapture(activation: VoiceActivation, revision: number): Promise<void> {
    const current = () => this.activation === activation && revision === this.microphoneRevision && this.microphoneWanted &&
      this.ready && !this.relayRecovery && this.snapshot.connection === 'ready' && this.isForeground();
    if (!current()) return;
    try {
      const ack = await this.deps.api.control(activation.voice_session_id, activation.activation_epoch, { kind: 'mute_input', muted: false });
      if (!current()) return;
      if (ack.voice_session_id !== activation.voice_session_id || ack.activation_epoch !== activation.activation_epoch || ack.connection !== 'ready' || ack.capture !== 'capturing') {
        this.update({ error: 'Microphone resume is unconfirmed' }); return;
      }
      const endpoint = this.endpoint; await endpoint?.capture(true);
      if (current()) this.update({ microphone: 'capturing' });
      else await endpoint?.capture(false);
    } catch (error) { if (current()) { await this.end('device_unavailable'); this.update({ microphone: 'unavailable', error: message(error) }); } }
  }
  private revokeBeforeGeneration(generation: number): void {
    this.update({ captions: this.snapshot.captions.flatMap(item => {
      if (item.speaker === 'user' || (item.outputGeneration !== undefined && item.outputGeneration >= generation)) return [item];
      return (item.consumedUs ?? 0) > 0 ? [{ ...item, text: '', revoked: true }] : [];
    }) });
  }
  private caption(fragment: TranscriptFragment): void {
    const requirement = this.snapshot.sourceContextRequirement;
    if (fragment.speaker === 'user' && requirement?.source_ref.fragment_id === fragment.fragment_id && fragment.revision > requirement.source_ref.revision) this.setSourceContextRequirement(undefined);
    const scope = this.activation ?? this.observation; const epoch = scope && ('activation_epoch' in scope ? scope.activation_epoch : scope.epoch);
    const id = `${scope && ('voice_session_id' in scope ? scope.voice_session_id : scope.id)}:${epoch}:${fragment.speaker}:${fragment.fragment_id}`;
    const prior = this.snapshot.captions.find(item => item.id === id); if (prior && fragment.revision < prior.revision) return;
    const changed = prior && fragment.revision > prior.revision;
    const sealed = changed && (prior.consumedUs ?? 0) > 0 ? { ...prior, id: `${prior.id}:revision:${prior.revision}`, text: '', revoked: true } : undefined;
    const caption: Caption = { id, speaker: fragment.speaker, text: fragment.text, revision: fragment.revision, committed: fragment.commit === 'committed',
      outputGeneration: fragment.speaker === 'assistant' && this.activation ? this.generation : undefined,
      consumedUs: changed ? undefined : prior?.consumedUs, playbackPrecision: changed ? undefined : prior?.playbackPrecision };
    this.update({ captions: [...this.snapshot.captions.filter(item => item.id !== id), ...(sealed ? [sealed] : []), caption].slice(-160) });
  }
  private played(operation: number, cursor: PlaybackCursor): void {
    const activation = this.activation; if (!activation || operation !== this.operation || cursor.output_generation !== this.generation) return;
    const key = `${cursor.segment_id}:${cursor.revision}:${cursor.output_generation}`; const prior = this.receipts.get(key);
    const receipt: PlaybackReceipt = { activation_epoch: activation.activation_epoch, segment_id: cursor.segment_id, revision: cursor.revision,
      output_generation: cursor.output_generation, state: 'played', consumed_us: Math.max(prior?.consumed_us ?? 0, cursor.consumed_us), uncertain_tail_us: cursor.uncertain_tail_us, precision: cursor.precision };
    this.receipts.set(key, receipt); if (this.receipts.size > 256) this.receipts.delete(this.receipts.keys().next().value!);
    this.diagnostics.playbackReceipts++;
    const started = this.outputStarted.get(cursor.segment_id);
    if (receipt.consumed_us > 0 && started !== undefined && !this.outputReported.has(cursor.segment_id)) {
      this.outputReported.add(cursor.segment_id); this.diagnostics.add(this.diagnostics.outputToReportedConsumptionMs, this.deps.now() - started);
    }
    this.receiptQueue.set(key, receipt);
    if (!this.receiptWriting) {
      this.receiptWriting = true;
      this.receiptTail = (async () => {
        while (this.activation === activation && this.receiptQueue.size) {
          const [identity, latest] = this.receiptQueue.entries().next().value!; this.receiptQueue.delete(identity);
          try { await this.deps.api.control(activation.voice_session_id, activation.activation_epoch, { kind: 'playback', receipt: latest }); }
          catch { if (this.activation === activation) this.update({ error: 'Playback consumption is unconfirmed' }); }
        }
      })().finally(() => { if (this.receiptWriter === activation) this.receiptWriting = false; });
    }
    this.update({ playback: cursor.finished ? 'quiet' : 'playing', captions: this.snapshot.captions.map(caption =>
      caption.id === `${activation.voice_session_id}:${activation.activation_epoch}:assistant:${cursor.segment_id}` && receipt.consumed_us > 0
        ? { ...caption, consumedUs: receipt.consumed_us, playbackPrecision: receipt.precision } : caption) });
  }
  async microphone(): Promise<void> {
    const activation = this.activation; if (!activation || !['ready', 'recovering'].includes(this.snapshot.connection)) return;
    const muted = this.microphoneWanted; this.microphoneWanted = !muted; const revision = ++this.microphoneRevision;
    this.update({ microphone: 'paused', level: 0 });
    if (!muted) { if (this.ready && !this.relayRecovery) await this.resumeRequestedCapture(activation, revision); return; }
    try {
      await this.endpoint?.capture(false);
      if (this.activation !== activation) return;
      await this.deps.api.control(activation.voice_session_id, activation.activation_epoch, { kind: 'mute_input', muted: true });
    } catch (error) { await this.end('device_unavailable'); this.update({ microphone: 'unavailable', error: message(error) }); }
  }
  async stopSpeaking(): Promise<void> {
    const activation = this.activation; if (!activation) return;
    const played = [...this.receipts.values()].reverse().find(item => item.output_generation === this.generation);
    ++this.generation; const started = this.deps.now(); this.endpoint?.flush(this.generation);
    this.revokeBeforeGeneration(this.generation);
    this.diagnostics.add(this.diagnostics.localFlushInvocationMs, this.deps.now() - started); this.update({ playback: 'interrupted', bufferedUs: 0 });
    try { await this.deps.api.control(activation.voice_session_id, activation.activation_epoch, { kind: 'interrupt_output', output_generation: this.generation, played }); }
    catch (error) { this.update({ error: message(error) }); }
  }
  async end(reason: VoiceCloseReason = 'user_ended'): Promise<void> {
    if (this.ending) return this.ending;
    const ending = this.finishEnd(reason); this.ending = ending;
    try { await ending; } finally { if (this.ending === ending) this.ending = undefined; }
  }
  private async finishEnd(reason: VoiceCloseReason): Promise<void> {
    this.setSourceContextRequirement(undefined);
    this.microphoneWanted = false; ++this.microphoneRevision;
    const operation = ++this.operation; this.closeObservation?.abort(); this.stopObservation(); const activation = this.activation; this.activation = undefined;
    const receipts = [...this.receipts.values()]; const tail = this.receiptTail;
    this.update({ connection: 'closing', microphone: 'off', playback: 'quiet', level: 0 });
    try { await this.localClose(); } catch { this.update({ error: 'Audio resource cleanup is unconfirmed' }); }
    if (activation) {
      const abort = new AbortController(); const timeout = setTimeout(() => abort.abort(), 2000);
      try {
        await Promise.race([tail, new Promise<void>(resolve => abort.signal.addEventListener('abort', () => resolve(), { once: true }))]);
        for (const receipt of receipts) { if (abort.signal.aborted) break;
          await this.deps.api.control(activation.voice_session_id, activation.activation_epoch, { kind: 'playback', receipt }, abort.signal); }
      } catch { this.update({ error: 'Final playback consumption is unconfirmed' }); } finally { clearTimeout(timeout); }
      try { await this.deps.api.control(activation.voice_session_id, activation.activation_epoch, { kind: 'close', reason }); }
      catch { this.update({ error: 'Voice close is unconfirmed' }); }
    }
    if (this.operation === operation) this.update({ connection: 'closed' });
  }
  private async closeFromServer(final = false, confirmed = true): Promise<void> {
    const activation = this.activation; if (!activation) return;
    this.setSourceContextRequirement(undefined);
    this.microphoneWanted = false; ++this.microphoneRevision;
    const operation = ++this.operation; this.activation = undefined;
    this.closeObservation?.abort(); const abort = new AbortController(); this.closeObservation = abort;
    this.update({ connection: final ? 'closed' : 'closing', microphone: 'off', playback: 'quiet', level: 0,
      error: final && !confirmed ? 'Voice model finalization is unconfirmed' : this.snapshot.error });
    try { await this.localClose(); } catch { if (this.operation === operation) this.update({ error: 'Audio resource cleanup is unconfirmed' }); }
    if (final) return;
    for (let attempt = 0; attempt < 8 && !abort.signal.aborted && operation === this.operation; attempt++) {
      try {
        const projection = await this.deps.api.projection(activation.voice_session_id, activation.activation_epoch, abort.signal);
        if (abort.signal.aborted || this.operation !== operation) return;
        if (['closed', 'failed'].includes(projection.state.connection)) { this.update({ connection: projection.state.connection }); return; }
      } catch { break; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (this.operation === operation && !abort.signal.aborted) this.update({ connection: 'closed', error: 'Voice close confirmation is unavailable' });
  }
  private async localClose(): Promise<void> {
    this.ready = false; clearInterval(this.watchdog); clearInterval(this.heartbeat); this.heartbeat = undefined; this.watchdog = undefined; this.credits?.clear(); this.credits = undefined;
    const socket = this.socket; this.socket = undefined; if (socket) { socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null; socket.close(); }
    const endpoint = this.endpoint; this.endpoint = undefined; await endpoint?.close();
  }
  async observe(binding: VoiceBinding, id: string, epoch: number): Promise<void> {
    if (this.activation) throw new Error('End the active endpoint before observing');
    ++this.operation; this.stopObservation(); this.generation = 0; this.setSourceContextRequirement(undefined);
    const observation = { id, epoch, abort: new AbortController(), timer: undefined as ReturnType<typeof setTimeout> | undefined }; this.observation = observation;
    this.update({ role: 'observer', binding, connection: 'opening', microphone: 'off', playback: 'quiet', captions: [], approvals: [] });
    const poll = async () => { try {
      const projection = await this.deps.api.projection(id, epoch, observation.abort.signal);
      if (this.observation !== observation) return;
      if (projection.state.voice_session_id !== id || projection.state.activation_epoch !== epoch || projection.state.output_generation < this.generation) throw new Error('Voice observation identity changed');
      this.generation = projection.state.output_generation;
      this.update({ connection: projection.state.connection, workRunning: projection.state.work_running, lastReceipt: projection.last_work_receipt ?? undefined,
        approvals: projection.approvals, captions: this.observerCaptions(projection, id, epoch), sourceContextRequirement: projection.source_context_requirement ?? undefined });
      if (['closed', 'failed'].includes(projection.state.connection)) return;
    } catch (error) { if (this.observation === observation) this.update({ connection: 'failed', error: message(error) }); return; }
      if (this.observation === observation) observation.timer = setTimeout(() => void poll(), 750);
    }; await poll();
  }
  /** Projection is a complete snapshot. Only timing facts survive between polls;
   * removed transcript bodies can never be resurrected from the local cache. */
  private observerCaptions(projection: VoiceProjection, id: string, epoch: number): Caption[] {
    const captions = new Map<string, Caption>();
    for (const fragment of projection.transcripts) {
      const identity = `${id}:${epoch}:${fragment.speaker}:${fragment.fragment_id}`;
      const prior = captions.get(identity); if (prior && prior.revision > fragment.revision) continue;
      captions.set(identity, { id: identity, speaker: fragment.speaker, revision: fragment.revision, text: fragment.text,
        committed: fragment.commit === 'committed', outputGeneration: fragment.speaker === 'assistant' ? projection.state.output_generation : undefined });
    }
    const timings = new Map<string, Caption>();
    for (const prior of this.snapshot.captions) if ((prior.consumedUs ?? 0) > 0) timings.set(prior.id, { ...prior, text: '', timingOnly: true });
    for (const receipt of projection.playback_receipts) {
      if (receipt.activation_epoch !== epoch || receipt.state === 'queued' || receipt.consumed_us <= 0) continue;
      const identity = `${id}:${epoch}:timing:${receipt.segment_id}:${receipt.revision}:${receipt.output_generation}`;
      const prior = timings.get(identity); if ((prior?.consumedUs ?? 0) > receipt.consumed_us) continue;
      timings.set(identity, { id: identity, speaker: 'assistant', text: '', revision: receipt.revision, committed: true,
        outputGeneration: receipt.output_generation, consumedUs: receipt.consumed_us, playbackPrecision: receipt.precision, timingOnly: true });
    }
    return [...timings.values(), ...captions.values()].slice(-160);
  }
  private stopObservation() { this.observation?.abort.abort(); clearTimeout(this.observation?.timer); this.observation = undefined; }
  background(): void { this.endpoint?.flush(this.generation + 1); void this.end('device_unavailable'); }
  volume(value: number): void { this.localVolume = Math.max(0, Math.min(1, value)); this.endpoint?.volume(this.localVolume); }
  getVolume(): number { return this.localVolume; }
  async work(request: WorkRequest): Promise<void> {
    const activation = this.activation; if (!activation || !this.deps.api.work) throw new Error('Work control is unavailable');
    const receipt = await this.deps.api.work(activation.voice_session_id, activation.activation_epoch, request, this.deps.identity());
    if (this.activation === activation) this.update({ lastReceipt: receipt });
  }
  private async rebuild(): Promise<void> {
    const old = this.activation, binding = this.snapshot.binding; if (!old || !binding || binding.transport !== 'native_webrtc') return;
    const resumeCapture = this.snapshot.microphone === 'capturing';
    const operation = ++this.operation; await this.localClose(); this.update({ connection: 'recovering', microphone: 'off', playback: 'interrupted' });
    const endpoint = this.deps.endpoints.create({ capture: (metadata, payload) => this.capture(operation, metadata, payload), playback: cursor => this.played(operation, cursor),
      unavailable: reason => { if (operation === this.operation) void this.end(reason as VoiceCloseReason); }, level: () => {} }); this.endpoint = endpoint;
    try {
      const offer = await endpoint.prepare('native_webrtc', binding.native_requirements ?? undefined); if (operation !== this.operation) return;
      const next = await this.deps.api.attachment(old.voice_session_id, old.activation_epoch, offer!);
      if (operation !== this.operation) { await this.deps.api.control(next.voice_session_id, next.activation_epoch, { kind: 'close', reason: 'user_ended' }); return; }
      this.activation = next; this.receiptWriter = next; this.generation = next.state.output_generation;
      this.setSourceContextRequirement(undefined);
      this.segments.clear(); this.receipts.clear(); this.receiptQueue.clear(); this.receiptWriting = false; this.receiptTail = Promise.resolve();
      const device = await endpoint.configure(next.negotiation, this.generation); endpoint.volume(this.localVolume); await this.connect(next, operation);
      if (operation !== this.operation) return; this.ready = true; await endpoint.startOutput?.();
      if (resumeCapture) await endpoint.capture(true);
      else { await endpoint.capture(false); await this.deps.api.control(next.voice_session_id, next.activation_epoch, { kind: 'mute_input', muted: true }); }
      if (operation === this.operation) this.update({ connection: 'ready', microphone: resumeCapture ? 'capturing' : 'paused', device });
    } catch (error) { if (operation === this.operation) { await this.end('provider_failed'); this.update({ error: message(error), connection: 'failed' }); } }
  }
}
