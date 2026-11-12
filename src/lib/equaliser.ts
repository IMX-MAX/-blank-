/**
 * The equaliser: ten bands an octave apart, a preamp, presets and saved custom presets. Pure data and maths; the
 * audio side is in audio-engine.ts.
 */

export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const EQ_BAND_COUNT = EQ_FREQUENCIES.length;
/** Each band goes from −12 to +12 dB, in half-decibel steps. */
export const BAND_LIMIT = 12;
export const PREAMP_MIN = -12;
export const PREAMP_MAX = 6;
/** Octave-wide peaking bands. */
export const BAND_Q = 1.41;

export type EqPreset = { id: string; name: string; bands: number[]; preamp: number; night?: boolean };

export type EqState = {
  enabled: boolean;
  bands: number[];
  preamp: number;
  /** Late Night: gentle compression so quiet passages come up and loud ones do not jump out. */
  night: boolean;
  /** The preset picked, or 'custom' once a band is moved away from it. */
  preset: string;
};

const flat = () => Array.from({ length: EQ_BAND_COUNT }, () => 0);

export const BUILT_IN_PRESETS: EqPreset[] = [
  { id: 'flat', name: 'Flat', bands: flat(), preamp: 0 },
  { id: 'bass-boost', name: 'Bass Boost', bands: [6, 5.5, 4.5, 3, 1, 0, 0, 0, 0, 0], preamp: -4.5 },
  { id: 'treble-boost', name: 'Treble Boost', bands: [0, 0, 0, 0, 0, 1, 2.5, 4, 5, 6], preamp: -4.5 },
  { id: 'vocal', name: 'Vocal', bands: [-2, -2, -1, 0, 2, 3.5, 3.5, 2, 0.5, -1], preamp: -3 },
  { id: 'rock', name: 'Rock', bands: [4.5, 3.5, 2, 0.5, -1, -0.5, 1, 2.5, 3.5, 4], preamp: -3.5 },
  { id: 'pop', name: 'Pop', bands: [-1, 0, 1.5, 3, 4, 3, 1.5, 0, -0.5, -1], preamp: -3.5 },
  { id: 'electronic', name: 'Electronic', bands: [5, 4.5, 2, 0, -1.5, 1, 0.5, 2, 4, 4.5], preamp: -4 },
  { id: 'hip-hop', name: 'Hip-Hop', bands: [5.5, 5, 2.5, 1.5, -1, -1, 1, 0, 1.5, 2.5], preamp: -4.5 },
  { id: 'jazz', name: 'Jazz', bands: [3, 2, 1, 2, -1.5, -1.5, 0, 1.5, 3, 3.5], preamp: -3 },
  { id: 'classical', name: 'Classical', bands: [3.5, 3, 2, 1, -1, -1, 0, 2, 3, 3.5], preamp: -3 },
  { id: 'acoustic', name: 'Acoustic', bands: [3, 3, 2, 1, 1.5, 1, 2, 2.5, 2, 1.5], preamp: -2.5 },
  { id: 'late-night', name: 'Late Night', bands: [-1, 0, 1.5, 2, 1, 0.5, 0.5, 0, -1.5, -2.5], preamp: 0, night: true },
];

export const EQ_DEFAULT: EqState = { enabled: true, bands: flat(), preamp: 0, night: false, preset: 'flat' };

const roundHalf = (value: number) => Math.round(value * 2) / 2;
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
export const clampBand = (db: number) => Math.min(BAND_LIMIT, Math.max(-BAND_LIMIT, roundHalf(num(db))));
export const clampPreamp = (db: number) => Math.min(PREAMP_MAX, Math.max(PREAMP_MIN, roundHalf(num(db))));

/** Whether the equaliser changes the sound at all (so playback can skip it). */
export function eqActive(eq: EqState): boolean {
  return eq.enabled && (eq.preamp !== 0 || eq.night || eq.bands.some((band) => band !== 0));
}

/** What actually reaches the audio graph: everything at 0 when the equaliser is switched off. */
export function effectiveEq(eq: EqState): { bands: number[]; preamp: number; night: boolean } {
  return eq.enabled ? { bands: eq.bands, preamp: eq.preamp, night: eq.night } : { bands: flat(), preamp: 0, night: false };
}

export function applyPreset(eq: EqState, preset: EqPreset): EqState {
  return { ...eq, enabled: true, bands: preset.bands.map(clampBand), preamp: clampPreamp(preset.preamp), night: preset.night === true, preset: preset.id };
}

/** Moving a band or the preamp: the preset becomes "custom" unless the values match one exactly. */
export function editEq(eq: EqState, change: { band?: number; value?: number; preamp?: number }, presets: EqPreset[] = BUILT_IN_PRESETS): EqState {
  const bands = [...eq.bands];
  if (change.band !== undefined && change.value !== undefined && change.band >= 0 && change.band < EQ_BAND_COUNT) bands[change.band] = clampBand(change.value);
  const preamp = change.preamp !== undefined ? clampPreamp(change.preamp) : eq.preamp;
  const next = { ...eq, enabled: true, bands, preamp };
  return { ...next, preset: matchPreset(next, presets) ?? 'custom' };
}

export function matchPreset(eq: Pick<EqState, 'bands' | 'preamp' | 'night'>, presets: EqPreset[]): string | null {
  const found = presets.find(
    (preset) => preset.preamp === eq.preamp && (preset.night === true) === eq.night && preset.bands.every((band, at) => band === eq.bands[at]),
  );
  return found?.id ?? null;
}

/**
 * Reads a saved equaliser. Also takes the old three-band one ({ bass, mid, treble }) and spreads it over the ten
 * bands, so an equaliser set before the update sounds about the same after it.
 */
export function normaliseEq(raw: unknown): EqState {
  if (!raw || typeof raw !== 'object') return { ...EQ_DEFAULT, bands: flat() };
  const value = raw as Record<string, unknown>;
  if (Array.isArray(value.bands)) {
    const bands = flat().map((_, at) => clampBand(num((value.bands as unknown[])[at])));
    return {
      enabled: value.enabled !== false,
      bands,
      preamp: clampPreamp(num(value.preamp)),
      night: value.night === true,
      preset: typeof value.preset === 'string' && value.preset ? value.preset : 'custom',
    };
  }
  if ('bass' in value || 'mid' in value || 'treble' in value) {
    const bass = clampBand(num(value.bass));
    const mid = clampBand(num(value.mid));
    const treble = clampBand(num(value.treble));
    const half = (a: number, b: number) => clampBand((a + b) / 2);
    const bands = [bass, bass, bass, half(bass, mid), mid, mid, mid, half(mid, treble), treble, treble];
    const eq = { enabled: true, bands, preamp: 0, night: false, preset: 'custom' };
    return { ...eq, preset: matchPreset(eq, BUILT_IN_PRESETS) ?? 'custom' };
  }
  return { ...EQ_DEFAULT, bands: flat() };
}

/** Saved custom presets, leaving out anything that does not read as one. */
export function normalisePresets(raw: unknown): EqPreset[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .filter((item) => typeof item.id === 'string' && typeof item.name === 'string' && Array.isArray(item.bands))
    .map((item) => ({
      id: item.id as string,
      name: (item.name as string).slice(0, 40),
      bands: flat().map((_, at) => clampBand(num((item.bands as unknown[])[at]))),
      preamp: clampPreamp(num(item.preamp)),
      night: item.night === true,
    }));
}

/** Saves the current sound as a named preset, replacing one of the same name. */
export function saveCustomPreset(presets: EqPreset[], name: string, eq: EqState, id = `custom-${Date.now().toString(36)}`): { presets: EqPreset[]; preset: EqPreset } {
  const clean = name.trim().slice(0, 40) || 'My preset';
  const existing = presets.find((preset) => preset.name.toLowerCase() === clean.toLowerCase());
  const preset: EqPreset = { id: existing?.id ?? id, name: clean, bands: [...eq.bands], preamp: eq.preamp, night: eq.night };
  return { presets: existing ? presets.map((item) => (item.id === existing.id ? preset : item)) : [...presets, preset], preset };
}

export const formatDb = (db: number) => `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toString()} dB`;
export const formatHz = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));

/* ---------- The curve, for drawing: the gain the filter chain gives at a frequency ---------- */

const SAMPLE_RATE = 48000;

type Kind = 'lowshelf' | 'peaking' | 'highshelf';
/** The first band is a low shelf and the last a high shelf, so the ends reach the edges of the spectrum. */
export const bandKind = (at: number): Kind => (at === 0 ? 'lowshelf' : at === EQ_BAND_COUNT - 1 ? 'highshelf' : 'peaking');

/** Magnitude in dB of one RBJ-cookbook biquad (the formulas Web Audio's BiquadFilterNode uses). */
export function biquadDb(kind: Kind, f0: number, gainDb: number, frequency: number, q = BAND_Q, sampleRate = SAMPLE_RATE): number {
  if (gainDb === 0) return 0;
  const A = 10 ** (gainDb / 40);
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (kind === 'peaking') {
    const alpha = sin / (2 * q);
    b0 = 1 + alpha * A;
    b1 = -2 * cos;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cos;
    a2 = 1 - alpha / A;
  } else {
    // Shelf slope 1, as Web Audio uses.
    const alpha = (sin / 2) * Math.SQRT2;
    const root = 2 * Math.sqrt(A) * alpha;
    if (kind === 'lowshelf') {
      b0 = A * (A + 1 - (A - 1) * cos + root);
      b1 = 2 * A * (A - 1 - (A + 1) * cos);
      b2 = A * (A + 1 - (A - 1) * cos - root);
      a0 = A + 1 + (A - 1) * cos + root;
      a1 = -2 * (A - 1 + (A + 1) * cos);
      a2 = A + 1 + (A - 1) * cos - root;
    } else {
      b0 = A * (A + 1 + (A - 1) * cos + root);
      b1 = -2 * A * (A - 1 + (A + 1) * cos);
      b2 = A * (A + 1 + (A - 1) * cos - root);
      a0 = A + 1 - (A - 1) * cos + root;
      a1 = 2 * (A - 1 - (A + 1) * cos);
      a2 = A + 1 - (A - 1) * cos - root;
    }
  }
  const w = (2 * Math.PI * frequency) / sampleRate;
  // |H(e^jw)|² from the coefficients.
  const re = (c0: number, c1: number, c2: number) => c0 + c1 * Math.cos(w) + c2 * Math.cos(2 * w);
  const im = (c1: number, c2: number) => -(c1 * Math.sin(w) + c2 * Math.sin(2 * w));
  const num2 = re(b0, b1, b2) ** 2 + im(b1, b2) ** 2;
  const den2 = re(a0, a1, a2) ** 2 + im(a1, a2) ** 2;
  return 10 * Math.log10(num2 / den2);
}

/** Total gain in dB at a frequency, all bands plus the preamp. */
export function responseDb(bands: readonly number[], preamp: number, frequency: number): number {
  let total = preamp;
  bands.forEach((gain, at) => {
    total += biquadDb(bandKind(at), EQ_FREQUENCIES[at]!, gain, frequency);
  });
  return total;
}
