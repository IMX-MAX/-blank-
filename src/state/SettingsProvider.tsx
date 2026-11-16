import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';

import { HAPTICS_KEY, setHapticsEnabled } from '../lib/haptics';
import { normaliseEq, normalisePresets, type EqPreset, type EqState } from '../lib/equaliser';
import { glyphMatrix, type GlyphMode } from '../lib/glyph';

export type ThemeChoice = 'dark' | 'light' | 'system';

type SettingsValue = {
  theme: ThemeChoice;
  resolvedTheme: 'dark' | 'light';
  setTheme: (theme: ThemeChoice) => void;
  /** Show a song's own cover instead of its album's in the playback bar and the player. */
  songCovers: boolean;
  setSongCovers: (on: boolean) => void;
  /** Keep lyrics on the phone as songs are played, so they open offline. */
  cacheLyrics: boolean;
  setCacheLyrics: (on: boolean) => void;
  /** This phone has a Glyph Matrix the app can draw on. */
  glyphSupported: boolean;
  /** Draw the playback waveform bar on the Glyph Matrix. */
  glyphWaveform: boolean;
  setGlyphWaveform: (on: boolean) => void;
  /** What the Glyph Matrix draws. */
  glyphMode: GlyphMode;
  setGlyphMode: (mode: GlyphMode) => void;
  /** This phone has a vibration motor the app can use. */
  vibrateSupported: boolean;
  /** Vibrate to the beat of the song. */
  vibrate: boolean;
  setVibrate: (on: boolean) => void;
  /** Show a reading under Korean, Japanese and Chinese lyrics. */
  pronunciation: boolean;
  estimateWords: boolean;
  setEstimateWords: (on: boolean) => void;
  setPronunciation: (on: boolean) => void;
  /** Show a translation under lyrics in another language, like Apple Music. */
  translation: boolean;
  setTranslation: (on: boolean) => void;
  /** Pause when headphones or Bluetooth audio disconnect, or Bluetooth switches device. */
  pauseOnDisconnect: boolean;
  setPauseOnDisconnect: (on: boolean) => void;
  /** Haptic feedback on taps, slider steps and long presses. */
  haptics: boolean;
  setHaptics: (on: boolean) => void;
  /** Keep the screen on while the lyrics are open. */
  keepAwake: boolean;
  setKeepAwake: (on: boolean) => void;
  /** Ten-band equaliser with preamp, on/off and the preset picked. */
  eq: EqState;
  setEq: (eq: EqState) => void;
  /** Equaliser presets saved by the user. */
  eqPresets: EqPreset[];
  setEqPresets: (presets: EqPreset[]) => void;
  /** Seconds of overlap between songs, 0 for none. */
  crossfade: number;
  setCrossfade: (seconds: number) => void;
};

const SettingsContext = createContext<SettingsValue | null>(null);

// Dark mode is pure black now; the old "Pure black" switch is gone.
if (typeof localStorage !== 'undefined') localStorage.removeItem('blank.oled');
const THEME_KEY = 'blank.theme';
const COVERS_KEY = 'blank.songCovers';
const LYRICS_KEY = 'blank.cacheLyrics';
const GLYPH_KEY = 'blank.glyphWaveform';
const GLYPH_MODE_KEY = 'blank.glyphMode';
const VIBRATE_KEY = 'blank.vibrate';
const AWAKE_KEY = 'blank.keepAwake';
const ROMAN_KEY = 'blank.pronunciation';
const TRANSLATION_KEY = 'blank.translation';
const NOISY_KEY = 'blank.pauseOnDisconnect';
const ESTIMATE_KEY = 'blank.estimateWords';
const EQ_KEY = 'blank.eq';
const EQ2_KEY = 'blank.eq2';
const EQ_PRESETS_KEY = 'blank.eqPresets';
const CROSSFADE_KEY = 'blank.crossfade';

/** The ten-band equaliser, or the old three-band one carried over the first time. */
function readEq(): EqState {
  try {
    const saved = localStorage.getItem(EQ2_KEY);
    return normaliseEq(JSON.parse(saved ?? localStorage.getItem(EQ_KEY) ?? 'null'));
  } catch {
    return normaliseEq(null);
  }
}

function readEqPresets(): EqPreset[] {
  try {
    return normalisePresets(JSON.parse(localStorage.getItem(EQ_PRESETS_KEY) ?? '[]'));
  } catch {
    return [];
  }
}

function readGlyphMode(): GlyphMode {
  const stored = localStorage.getItem(GLYPH_MODE_KEY);
  return stored === 'lyrics' || stored === 'pulse' ? stored : 'waveform';
}

function readTheme(): ThemeChoice {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'system' ? stored : 'dark';
}

function systemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>(readTheme);
  const [system, setSystem] = useState<'dark' | 'light'>(systemTheme);
  const [songCovers, setSongCoversState] = useState(() => localStorage.getItem(COVERS_KEY) === '1');
  const [cacheLyrics, setCacheLyricsState] = useState(() => localStorage.getItem(LYRICS_KEY) === '1');
  const [glyphWaveform, setGlyphWaveformState] = useState(() => localStorage.getItem(GLYPH_KEY) === '1');
  const [glyphSupported, setGlyphSupported] = useState(false);
  const [glyphMode, setGlyphModeState] = useState<GlyphMode>(readGlyphMode);
  const [vibrate, setVibrateState] = useState(() => localStorage.getItem(VIBRATE_KEY) === '1');
  const [vibrateSupported, setVibrateSupported] = useState(false);
  const [pronunciation, setPronunciationState] = useState(() => localStorage.getItem(ROMAN_KEY) !== '0');
  const [translation, setTranslationState] = useState(() => localStorage.getItem(TRANSLATION_KEY) !== '0');
  const [pauseOnDisconnect, setPauseOnDisconnectState] = useState(() => localStorage.getItem(NOISY_KEY) !== '0');
  const [estimateWords, setEstimateWordsState] = useState(() => localStorage.getItem(ESTIMATE_KEY) !== '0');
  const [haptics, setHapticsState] = useState(() => localStorage.getItem(HAPTICS_KEY) !== '0');
  const [keepAwake, setKeepAwakeState] = useState(() => localStorage.getItem(AWAKE_KEY) === '1');
  const [eq, setEqState] = useState<EqState>(readEq);
  const [eqPresets, setEqPresetsState] = useState<EqPreset[]>(readEqPresets);
  const [crossfade, setCrossfadeState] = useState(() => {
    const seconds = Number(localStorage.getItem(CROSSFADE_KEY));
    return Number.isFinite(seconds) ? Math.min(12, Math.max(0, Math.round(seconds))) : 0;
  });
  const resolvedTheme = theme === 'system' ? system : theme;

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const update = () => setSystem(query.matches ? 'light' : 'dark');
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme === 'light' ? '#f6f6f8' : '#000000');
  }, [resolvedTheme]);

  const setTheme = useCallback((next: ThemeChoice) => {
    localStorage.setItem(THEME_KEY, next);
    setThemeState(next);
  }, []);

  const setSongCovers = useCallback((on: boolean) => {
    localStorage.setItem(COVERS_KEY, on ? '1' : '0');
    setSongCoversState(on);
  }, []);

  const setCacheLyrics = useCallback((on: boolean) => {
    localStorage.setItem(LYRICS_KEY, on ? '1' : '0');
    setCacheLyricsState(on);
  }, []);

  const setGlyphWaveform = useCallback((on: boolean) => {
    localStorage.setItem(GLYPH_KEY, on ? '1' : '0');
    setGlyphWaveformState(on);
  }, []);

  const setGlyphMode = useCallback((mode: GlyphMode) => {
    localStorage.setItem(GLYPH_MODE_KEY, mode);
    setGlyphModeState(mode);
  }, []);

  const setVibrate = useCallback((on: boolean) => {
    localStorage.setItem(VIBRATE_KEY, on ? '1' : '0');
    setVibrateState(on);
  }, []);

  const setPronunciation = useCallback((on: boolean) => {
    localStorage.setItem(ROMAN_KEY, on ? '1' : '0');
    setPronunciationState(on);
  }, []);

  const setTranslation = useCallback((on: boolean) => {
    localStorage.setItem(TRANSLATION_KEY, on ? '1' : '0');
    setTranslationState(on);
  }, []);

  const setPauseOnDisconnect = useCallback((on: boolean) => {
    localStorage.setItem(NOISY_KEY, on ? '1' : '0');
    setPauseOnDisconnectState(on);
  }, []);

  const setEstimateWords = useCallback((on: boolean) => {
    localStorage.setItem(ESTIMATE_KEY, on ? '1' : '0');
    setEstimateWordsState(on);
  }, []);

  const setHaptics = useCallback((on: boolean) => {
    localStorage.setItem(HAPTICS_KEY, on ? '1' : '0');
    setHapticsEnabled(on);
    setHapticsState(on);
  }, []);

  const setKeepAwake = useCallback((on: boolean) => {
    localStorage.setItem(AWAKE_KEY, on ? '1' : '0');
    setKeepAwakeState(on);
  }, []);

  const setEq = useCallback((next: EqState) => {
    const clean = normaliseEq(next);
    localStorage.setItem(EQ2_KEY, JSON.stringify(clean));
    setEqState(clean);
  }, []);

  const setEqPresets = useCallback((next: EqPreset[]) => {
    const clean = normalisePresets(next);
    localStorage.setItem(EQ_PRESETS_KEY, JSON.stringify(clean));
    setEqPresetsState(clean);
  }, []);

  const setCrossfade = useCallback((seconds: number) => {
    const clean = Math.min(12, Math.max(0, Math.round(seconds)));
    localStorage.setItem(CROSSFADE_KEY, String(clean));
    setCrossfadeState(clean);
  }, []);

  useEffect(() => {
    if (!glyphMatrix) return;
    let live = true;
    glyphMatrix
      .isSupported()
      .then((result) => {
        if (!live) return;
        setGlyphSupported(result.supported);
        setVibrateSupported(result.vibrator);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!glyphMatrix || !glyphSupported) return;
    void glyphMatrix.setEnabled({ enabled: glyphWaveform }).catch(() => undefined);
  }, [glyphSupported, glyphWaveform]);

  useEffect(() => {
    if (!glyphMatrix || !glyphSupported) return;
    void glyphMatrix.setMode({ mode: glyphMode }).catch(() => undefined);
  }, [glyphSupported, glyphMode]);

  useEffect(() => {
    if (!glyphMatrix || !vibrateSupported) return;
    void glyphMatrix.setVibrate({ enabled: vibrate }).catch(() => undefined);
  }, [vibrateSupported, vibrate]);

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      songCovers,
      setSongCovers,
      cacheLyrics,
      setCacheLyrics,
      glyphSupported,
      glyphWaveform,
      setGlyphWaveform,
      glyphMode,
      setGlyphMode,
      vibrateSupported,
      vibrate,
      setVibrate,
      pronunciation,
      setPronunciation,
      translation,
      setTranslation,
      pauseOnDisconnect,
      setPauseOnDisconnect,
      estimateWords,
      setEstimateWords,
      keepAwake,
      setKeepAwake,
      haptics,
      setHaptics,
      eq,
      setEq,
      eqPresets,
      setEqPresets,
      crossfade,
      setCrossfade,
    }),
    [
      theme,
      resolvedTheme,
      setTheme,
      songCovers,
      setSongCovers,
      cacheLyrics,
      setCacheLyrics,
      glyphSupported,
      glyphWaveform,
      setGlyphWaveform,
      glyphMode,
      setGlyphMode,
      vibrateSupported,
      vibrate,
      setVibrate,
      pronunciation,
      setPronunciation,
      translation,
      setTranslation,
      pauseOnDisconnect,
      setPauseOnDisconnect,
      estimateWords,
      setEstimateWords,
      keepAwake,
      setKeepAwake,
      haptics,
      setHaptics,
      eq,
      setEq,
      eqPresets,
      setEqPresets,
      crossfade,
      setCrossfade,
    ],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
