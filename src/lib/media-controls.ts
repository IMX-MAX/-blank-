import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { coverObjectUrl } from '../api';

export type ControlAction = {
  action: 'play' | 'pause' | 'next' | 'previous' | 'seekto';
  /** Seconds, for `seekto`. */
  position?: number;
};

type NowPlaying = {
  trackId: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  positionMs: number;
  playing: boolean;
  /** Base64 JPEG. Leave out to keep the artwork already shown. */
  artwork?: string;
  /** Waveform bars (0 to 1) for the Glyph Matrix. Leave out unless it is switched on. */
  peaks?: number[];
};

type NativeControls = {
  update(options: NowPlaying): Promise<void>;
  clear(): Promise<void>;
  addListener(event: 'action', listener: (action: ControlAction) => void): Promise<PluginListenerHandle>;
};

/** The lock screen and notification card on Android. Null on the web, which uses the browser's own media session. */
export const nativeControls: NativeControls | null = Capacitor.isNativePlatform()
  ? registerPlugin<NativeControls>('MediaControls')
  : null;

const SIZE = 512;

/** Cover art scaled down for the lock screen, or a plain gradient when the song has none. */
export async function artworkFor(fileId: string | null, hue: number | null): Promise<string | null> {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const context = canvas.getContext('2d');
    if (!context) return null;
    if (fileId) {
      const image = new Image();
      image.src = await coverObjectUrl(fileId);
      await image.decode();
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      context.drawImage(
        image,
        (image.naturalWidth - side) / 2,
        (image.naturalHeight - side) / 2,
        side,
        side,
        0,
        0,
        SIZE,
        SIZE,
      );
    } else {
      const base = hue ?? 310;
      const gradient = context.createLinearGradient(0, 0, 0, SIZE);
      gradient.addColorStop(0, `hsl(${base} 70% 80%)`);
      gradient.addColorStop(1, `hsl(${base} 55% 52%)`);
      context.fillStyle = gradient;
      context.fillRect(0, 0, SIZE, SIZE);
    }
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1] ?? null;
  } catch {
    return null;
  }
}
