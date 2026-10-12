import type { Track } from '../types';
import { findLyrics, isStale, type LyricsResult } from './lyrics';
import { getSavedLyrics, saveLyrics } from './lyrics-store';

/** Lyrics for a song: what is saved on the phone first, then a lookup that is saved when the user asked for that. */
export async function loadLyrics(
  track: Pick<Track, 'id' | 'title' | 'artist' | 'durationMs'>,
  album: string | undefined,
  signal: AbortSignal,
  saveForOffline: boolean,
): Promise<LyricsResult> {
  const identity = { id: track.id, title: track.title, artist: track.artist ?? '' };
  const saved = await getSavedLyrics(identity).catch(() => null);
  const have = saved;
  if (have && !isStale(have)) return have;
  let found: LyricsResult;
  try {
    found = await findLyrics({ title: track.title, artist: track.artist ?? '', album, duration: track.durationMs / 1000 }, signal);
  } catch (error) {
    if (have) return have;
    throw error;
  }
  if (found.status === 'none' && have) return have;
  if (found.status !== 'none') {
    if (saveForOffline || saved) void saveLyrics(identity, found).catch(() => undefined);
  }
  return found;
}
