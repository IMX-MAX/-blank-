import { Capacitor, registerPlugin } from '@capacitor/core';

type GlyphNative = {
  /** `length` is the matrix side in LEDs (13 on the Phone (4a) Pro, 25 on the Phone (3)). */
  isSupported(): Promise<{ supported: boolean; length: number }>;
  setEnabled(options: { enabled: boolean }): Promise<void>;
};

/** The Glyph Matrix on the back of some Nothing phones. Null on the web. */
export const glyphMatrix: GlyphNative | null = Capacitor.isNativePlatform() ? registerPlugin<GlyphNative>('GlyphMatrix') : null;
