import { Capacitor, registerPlugin } from '@capacitor/core';

export type GlyphMode = 'waveform' | 'lyrics' | 'pulse';

export type TrackData = {
  trackId: string;
  /** Synced lyric lines, seconds. */
  lines?: Array<{ start: number; end: number; text: string }>;
  /** Beat times in seconds, with a matching strength from 0 to 1 for each. */
  beatTimes?: number[];
  beatStrengths?: number[];
};

type GlyphNative = {
  /** `length` is the matrix side in LEDs (13 on the Phone (4a) Pro, 25 on the Phone (3)). */
  isSupported(): Promise<{ supported: boolean; length: number; vibrator: boolean }>;
  setEnabled(options: { enabled: boolean }): Promise<void>;
  setMode(options: { mode: GlyphMode }): Promise<void>;
  setVibrate(options: { enabled: boolean }): Promise<void>;
  setTrackData(options: TrackData): Promise<void>;
};

/** The Glyph Matrix on the back of some Nothing phones, and the vibration motor. Null on the web. */
export const glyphMatrix: GlyphNative | null = Capacitor.isNativePlatform() ? registerPlugin<GlyphNative>('GlyphMatrix') : null;
