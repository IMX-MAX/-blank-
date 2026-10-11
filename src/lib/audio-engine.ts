export type EqBands = { bass: number; mid: number; treble: number };

export const EQ_FLAT: EqBands = { bass: 0, mid: 0, treble: 0 };
export const EQ_LIMIT = 12;

export const isFlat = (bands: EqBands) => bands.bass === 0 && bands.mid === 0 && bands.treble === 0;

export const clampBand = (db: number) => Math.min(EQ_LIMIT, Math.max(-EQ_LIMIT, Math.round(db)));

/** Equal-power fade curves: the two songs together keep the same loudness all the way through. */
export function fadeCurves(steps = 64): { out: Float32Array; in: Float32Array } {
  const out = new Float32Array(steps);
  const incoming = new Float32Array(steps);
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    out[i] = Math.cos((t * Math.PI) / 2);
    incoming[i] = Math.sin((t * Math.PI) / 2);
  }
  return { out, in: incoming };
}

/**
 * The Web Audio graph behind playback: every player element goes through its own fade gain, then a
 * three-band equaliser and a master volume. It is built the first time the equaliser or crossfade is
 * needed, so a plain player never goes through it. Elements must play same-origin or blob audio.
 */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private inputs: GainNode[] = [];
  private gains = new WeakMap<HTMLAudioElement, GainNode>();
  private bands: { low: BiquadFilterNode; mid: BiquadFilterNode; high: BiquadFilterNode } | null = null;
  private master: GainNode | null = null;
  private fadeTimer: number | null = null;

  get connected(): boolean {
    return this.ctx !== null;
  }

  /** Builds the graph on first use, and wires in any element it has not seen yet. */
  ensure(elements: HTMLAudioElement[], eq: EqBands, volume: number) {
    if (!this.ctx) {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      const ctx = new Context({ latencyHint: 'playback' });

      const low = ctx.createBiquadFilter();
      low.type = 'lowshelf';
      low.frequency.value = 120;
      const mid = ctx.createBiquadFilter();
      mid.type = 'peaking';
      mid.frequency.value = 1000;
      mid.Q.value = 0.8;
      const high = ctx.createBiquadFilter();
      high.type = 'highshelf';
      high.frequency.value = 6000;
      const master = ctx.createGain();
      low.connect(mid);
      mid.connect(high);
      high.connect(master);
      master.connect(ctx.destination);

      this.bands = { low, mid, high };
      this.master = master;
      this.ctx = ctx;
      ctx.addEventListener('statechange', () => {
        if (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted') void ctx.resume().catch(() => undefined);
      });
      this.setEq(eq);
      this.setVolume(volume);
    }
    const ctx = this.ctx;
    const low = this.bands!.low;
    this.inputs = elements.map((element) => {
      let gain = this.gains.get(element);
      if (!gain) {
        gain = ctx.createGain();
        ctx.createMediaElementSource(element).connect(gain);
        gain.connect(low);
        element.volume = 1;
        this.gains.set(element, gain);
      }
      return gain;
    });
    void ctx.resume().catch(() => undefined);
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
  }

  setEq(eq: EqBands) {
    if (!this.ctx || !this.bands) return;
    const now = this.ctx.currentTime;
    this.bands.low.gain.setTargetAtTime(eq.bass, now, 0.015);
    this.bands.mid.gain.setTargetAtTime(eq.mid, now, 0.015);
    this.bands.high.gain.setTargetAtTime(eq.treble, now, 0.015);
  }

  setVolume(volume: number) {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.015);
  }

  /** Mutes one element so a song can start under the fade before it is brought in. */
  silence(index: number) {
    if (!this.ctx) return;
    const gain = this.inputs[index]!.gain;
    gain.cancelScheduledValues(0);
    gain.setValueAtTime(0, this.ctx.currentTime);
  }

  /** Fades element `from` out and element `to` in over `seconds`, then calls `done`. */
  crossfade(from: number, to: number, seconds: number, done: () => void) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const curves = fadeCurves();
    const outgoing = this.inputs[from]!.gain;
    const incoming = this.inputs[to]!.gain;
    outgoing.cancelScheduledValues(0);
    incoming.cancelScheduledValues(0);
    outgoing.setValueCurveAtTime(curves.out, now, seconds);
    incoming.setValueAtTime(0, now);
    incoming.setValueCurveAtTime(curves.in, now + 0.001, seconds);
    this.clearTimer();
    this.fadeTimer = window.setTimeout(() => {
      this.fadeTimer = null;
      done();
    }, seconds * 1000 + 60);
  }

  /** Back to full level on every element, dropping any fade in progress. */
  settle() {
    this.clearTimer();
    if (!this.ctx) return;
    for (const input of this.inputs) {
      input.gain.cancelScheduledValues(0);
      input.gain.setValueAtTime(1, this.ctx.currentTime);
    }
  }

  private clearTimer() {
    if (this.fadeTimer !== null) window.clearTimeout(this.fadeTimer);
    this.fadeTimer = null;
  }
}

export const audioEngine = new AudioEngine();
