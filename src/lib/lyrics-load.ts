import type { Track } from '../types';
import { findLyrics, type LyricsResult } from './lyrics';
import { getSavedLyrics, saveLyrics } from './lyrics-store';
import { getOfflineLyrics, setOfflineLyrics } from './offline';

/** Lyrics for a song: what is saved on the phone first, then a lookup that is saved when the user asked for that. */
export async function loadLyrics(
  track: Pick<Track, 'id' | 'title' | 'artist' | 'durationMs'>,
  album: string | undefined,
  signal: AbortSignal,
  saveForOffline: boolean,
): Promise<LyricsResult> {
  const identity = { id: track.id, title: track.title, artist: track.artist ?? '' };
  const saved = await getSavedLyrics(identity).catch(() => null);
  if (saved) return saved;
  const kept = await getOfflineLyrics(track.id).catch(() => null);
  if (kept) return kept;
  const found = await findLyrics({ title: track.title, artist: track.artist ?? '', album, duration: track.durationMs / 1000 }, signal);
  if (found.status !== 'none') {
    void setOfflineLyrics(track.id, found).catch(() => undefined);
    if (saveForOffline) void saveLyrics(identity, found).catch(() => undefined);
  }
  return found;
}
