import type { Track } from '../types';
import { LYRICS_VERSION, type Lyrics, type LyricsResult } from './lyric-types';
import { clearLyricsLookupCache, forgetCachedLyrics, setCachedLyrics } from './lyrics';
import { announceLyricsChange, invalidateLyricsWrites, markLyricsHttpStale } from './lyrics-epoch';
import { clearSavedLyrics, deleteSavedLyrics, saveLyrics } from './lyrics-store';
import { clearOfflineLyrics, removeOffline, setOfflineLyrics } from './offline';

/**
 * Every place a lyric can be kept, and the one way to empty each of them:
 *
 *   1. in-memory map + localStorage `blank.lyrics*`   (lyrics.ts, the rolling lookup cache)
 *   2. IndexedDB `blank-lyrics`                        (lyrics-store.ts, "save for offline" / pinned copies)
 *   3. IndexedDB `blank-offline` tracks[].lyrics       (offline.ts, lyrics stored with a downloaded song)
 *   4. service-worker / Cache Storage entries of the lyrics services (nothing is put there today)
 *   5. what the screens hold: LyricsView state and the lines handed to the Glyph Matrix service; both load
 *      again when `announceLyricsChange` fires.
 */

const LYRIC_HOSTS = ['lrclib.net', 'api.amll.dev', 'lyrics-api.boidu.dev', 'music.163.com'];

async function clearCacheStorage(): Promise<void> {
  if (typeof caches === 'undefined') return;
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      if (LYRIC_HOSTS.some((host) => new URL(request.url).hostname.endsWith(host))) await cache.delete(request);
    }
  }
}

export type ClearOutcome = { failed: string[] };

/** Wipes every cached lyric, in every layer, so the next open looks them up again. Never throws: reports what failed. */
export async function clearAllLyricsCaches(): Promise<ClearOutcome> {
  invalidateLyricsWrites();
  markLyricsHttpStale();
  const layers: Array<[string, () => Promise<unknown> | unknown]> = [
    ['lookup cache', clearLyricsLookupCache],
    ['saved lyrics', clearSavedLyrics],
    ['downloaded songs', () => clearOfflineLyrics()],
    ['browser cache', clearCacheStorage],
  ];
  const settled = await Promise.allSettled(layers.map(async ([, wipe]) => wipe()));
  // A lookup that finished while the layers were being emptied could have written to one again.
  clearLyricsLookupCache();
  announceLyricsChange();
  return { failed: layers.filter((_, index) => settled[index]!.status === 'rejected').map(([name]) => name) };
}

type TrackTags = Pick<Track, 'id' | 'title' | 'artist'>;

/** A song was deleted: forgets its lyrics in every layer (and the offline copy of the song itself). */
export async function forgetTrackLyrics(tracks: TrackTags[]): Promise<void> {
  if (!tracks.length) return;
  invalidateLyricsWrites();
  const ids = tracks.map((track) => track.id);
  for (const track of tracks) forgetCachedLyrics({ title: track.title, artist: track.artist ?? '' });
  const settled = await Promise.allSettled([deleteSavedLyrics(ids), clearOfflineLyrics(ids), removeOffline(ids)]);
  announceLyricsChange();
  const failed = settled.find((item): item is PromiseRejectedResult => item.status === 'rejected');
  if (failed) throw failed.reason;
}

/** The lyrics as saved when the user picks one by hand: never treated as old, so no automatic lookup replaces it. */
export function asChosen(result: Extract<LyricsResult, { status: 'found' }>): Extract<LyricsResult, { status: 'found' }> {
  const lyrics: Lyrics = { ...result.lyrics, v: LYRICS_VERSION, chosen: true };
  return { ...result, lyrics };
}

/** Makes `result` this song's lyrics everywhere, replacing whatever was cached, and tells the screens to reload. */
export async function saveChosenLyrics(
  track: Pick<Track, 'id' | 'title' | 'artist' | 'durationMs'>,
  result: Extract<LyricsResult, { status: 'found' }>,
): Promise<void> {
  invalidateLyricsWrites();
  const chosen = asChosen(result);
  const artist = track.artist ?? '';
  const query = { title: track.title, artist, duration: track.durationMs / 1000 };
  setCachedLyrics(query, chosen);
  const settled = await Promise.allSettled([saveLyrics({ id: track.id, title: track.title, artist }, chosen), setOfflineLyrics(track.id, chosen)]);
  announceLyricsChange();
  if (settled[0].status === 'rejected') throw settled[0].reason;
}
