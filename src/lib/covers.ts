import type { Album, Track } from '../types';

/** Which cover to show for a song. By default the album's, unless the song-cover setting is on and the song has its own. */
export function coverFor(track: Track, album: Album | undefined, preferSong: boolean): string | null {
  const own = track.coverFileId;
  const shared = album?.coverFileId ?? null;
  return preferSong ? (own ?? shared) : (shared ?? own);
}
