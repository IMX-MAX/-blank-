import { BAND_Q, EQ_FREQUENCIES, bandKind } from './equaliser';

/** What the audio graph is set to: ten band gains and a preamp in dB, and whether Late Night compression is on. */
export type EqSetting = { bands: number[]; preamp: number; night: boolean };

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
 * The Web Audio graph behind playback: every player element goes through its own fade gain, then a preamp,
 * a ten-band equaliser, a compressor (neutral unless Late Night is on) and a master volume. It is built the first time the equaliser or crossfade is
 * needed, so a plain player never goes through it. Elements must play same-origin or blob audio.
 */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private inputs: GainNode[] = [];
  private gains = new WeakMap<HTMLAudioElement, GainNode>();
  private filters: BiquadFilterNode[] = [];
  private preamp: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private master: GainNode | null = null;
  private fadeTimer: number | null = null;

  get connected(): boolean {
    return this.ctx !== null;
  }

  /** Builds the graph on first use, and wires in any element it has not seen yet. */
  ensure(elements: HTMLAudioElement[], eq: EqSetting, volume: number) {
    if (!this.ctx) {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      const ctx = new Context({ latencyHint: 'playback' });

      const preamp = ctx.createGain();
      const filters = EQ_FREQUENCIES.map((frequency, at) => {
        const filter = ctx.createBiquadFilter();
        filter.type = bandKind(at);
        filter.frequency.value = frequency;
        if (filter.type === 'peaking') filter.Q.value = BAND_Q;
        filter.gain.value = 0;
        return filter;
      });
      const compressor = ctx.createDynamicsCompressor();
      const master = ctx.createGain();
      let previous: AudioNode = preamp;
      for (const filter of filters) {
        previous.connect(filter);
        previous = filter;
      }
      previous.connect(compressor);
      compressor.connect(master);
      master.connect(ctx.destination);

      this.preamp = preamp;
      this.filters = filters;
      this.compressor = compressor;
      this.master = master;
      this.ctx = ctx;
      ctx.addEventListener('statechange', () => {
        if (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted') void ctx.resume().catch(() => undefined);
      });
      this.setEq(eq);
      this.setVolume(volume);
    }
    const ctx = this.ctx;
    const input = this.preamp!;
    this.inputs = elements.map((element) => {
      let gain = this.gains.get(element);
      if (!gain) {
        gain = ctx.createGain();
        ctx.createMediaElementSource(element).connect(gain);
        gain.connect(input);
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

  setEq(eq: EqSetting) {
    if (!this.ctx || !this.preamp || !this.compressor) return;
    const now = this.ctx.currentTime;
    this.filters.forEach((filter, at) => filter.gain.setTargetAtTime(eq.bands[at] ?? 0, now, 0.02));
    this.preamp.gain.setTargetAtTime(10 ** (eq.preamp / 20), now, 0.02);
    // Neutral settings leave the compressor doing nothing; Late Night brings quiet passages up and holds peaks.
    const c = this.compressor;
    c.threshold.setTargetAtTime(eq.night ? -30 : 0, now, 0.05);
    c.ratio.setTargetAtTime(eq.night ? 4 : 1, now, 0.05);
    c.knee.setTargetAtTime(eq.night ? 12 : 0, now, 0.05);
    c.attack.setTargetAtTime(eq.night ? 0.01 : 0.003, now, 0.05);
    c.release.setTargetAtTime(eq.night ? 0.3 : 0.25, now, 0.05);
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
