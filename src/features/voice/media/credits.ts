/** RN bufferedAmount is not treated as a transport receipt. The server returns
 * duration credit with input_admitted or input_released (paused discard).
 * A released frame was not admitted to a model; neither event asserts hearing,
 * playback or work acceptance. Unknown/duplicate credit cannot create capacity. */
export class InputCredits {
  private pending = new Map<number, { duration: number; admitted: number }>();
  private used = 0;
  constructor(private readonly maxDuration: number, private readonly maxAge: number, private readonly now: () => number) {}
  admit(sequence: number, duration: number): void {
    this.checkAge();
    if (this.pending.has(sequence) || duration <= 0 || this.used + duration > this.maxDuration) throw new Error('Voice input duration backlog');
    this.pending.set(sequence, { duration, admitted: this.now() }); this.used += duration;
  }
  acknowledge(sequence: number, duration: number): number | undefined {
    const frame = this.pending.get(sequence); if (!frame) return;
    if (frame.duration !== duration) throw new Error('Voice input credit differs from its admitted frame');
    this.pending.delete(sequence); this.used -= duration;
    return this.now() - frame.admitted;
  }
  checkAge(): void { for (const frame of this.pending.values()) if ((this.now() - frame.admitted) * 1000 > this.maxAge) throw new Error('Voice input age backlog'); }
  clear(): void { this.pending.clear(); this.used = 0; }
  get duration(): number { return this.used; }
}
