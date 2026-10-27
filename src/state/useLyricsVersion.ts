import { useSyncExternalStore } from 'react';
import { lyricsVersion, onLyricsChange } from '../lib/lyrics-epoch';

/** Goes up whenever cached lyrics were cleared or replaced, so a screen showing lyrics can load them again. */
export function useLyricsVersion(): number {
  return useSyncExternalStore(onLyricsChange, lyricsVersion);
}
