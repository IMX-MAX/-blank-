import { addDays, dayKey, mostPlayed, songTotals, type DayStats } from './stats';

/**
 * Playlists that fill themselves from listening stats, the played history and when songs were added. Pure
 * functions over the library, so they update whenever any of those change.
 */

export type SmartId = 'most-played' | 'recently-added' | 'recently-played' | 'never-played' | 'forgotten';
export type SmartWindow = '30d' | 'all';

export type SmartDefinition = { id: SmartId; name: string; description: string; hue: number; empty: string };

export const SMART_PLAYLISTS: SmartDefinition[] = [
  { id: 'most-played', name: 'Most Played', description: 'Your top 50 songs', hue: 42, empty: 'Songs you play for more than 30 seconds show up here.' },
  { id: 'recently-added', name: 'Recently Added', description: 'The newest 50 songs in your library', hue: 200, empty: 'Add songs to your library and the newest show up here.' },
  { id: 'recently-played', name: 'Recently Played', description: 'What you have played lately', hue: 330, empty: 'Songs you play show up here.' },
  { id: 'never-played', name: 'Never Played', description: 'Songs you have not listened to yet', hue: 150, empty: 'You have played every song in your library.' },
  { id: 'forgotten', name: 'Forgotten Favourites', description: 'Songs you loved but have not played for a month', hue: 270, empty: 'Songs you played a lot but not in the last month show up here.' },
];

export const SMART_LIMIT = 50;
/** A favourite: played at least this often. */
export const FAVOURITE_PLAYS = 3;
/** Forgotten: not played for this many days. */
export const FORGOTTEN_DAYS = 30;

export type SmartTrack = { id: string; createdAt: string };

export type SmartContext<T extends SmartTrack> = {
  tracks: T[];
  days: readonly DayStats[];
  /** Played history, oldest first (song ids). */
  history: readonly string[];
  today?: Date;
  window?: SmartWindow;
  limit?: number;
};

/** When a song was added, in ms; a date that does not read sorts as the oldest. */
export const addedAt = (track: SmartTrack) => {
  const time = Date.parse(track.createdAt);
  return Number.isFinite(time) ? time : 0;
};

export function buildSmartPlaylist<T extends SmartTrack>(id: SmartId, context: SmartContext<T>): T[] {
  const { tracks, days, history, today = new Date(), window = 'all', limit = SMART_LIMIT } = context;
  const byId = new Map(tracks.map((track) => [track.id, track]));
  const pick = (ids: Iterable<string>) => {
    const out: T[] = [];
    const seen = new Set<string>();
    for (const trackId of ids) {
      const track = byId.get(trackId);
      if (!track || seen.has(trackId)) continue;
      seen.add(trackId);
      out.push(track);
      if (out.length >= limit) break;
    }
    return out;
  };

  switch (id) {
    case 'most-played':
      return pick(mostPlayed(days, { withinDays: window === '30d' ? 30 : undefined, today, limit: limit * 2, exists: (trackId) => byId.has(trackId) }));
    case 'recently-added':
      return [...tracks].sort((a, b) => addedAt(b) - addedAt(a) || a.id.localeCompare(b.id)).slice(0, limit);
    case 'recently-played': {
      // The history is exact and newest last; stats days fill in from before it.
      const totals = [...songTotals(days).values()].sort((a, b) => b.lastDay.localeCompare(a.lastDay) || b.plays - a.plays);
      return pick([...[...history].reverse(), ...totals.map((song) => song.trackId)]);
    }
    case 'never-played': {
      const listened = new Set([...songTotals(days).values()].filter((song) => song.plays > 0).map((song) => song.trackId));
      for (const trackId of history) listened.add(trackId);
      return tracks.filter((track) => !listened.has(track.id)).sort((a, b) => addedAt(b) - addedAt(a)).slice(0, limit);
    }
    case 'forgotten': {
      const cutoff = dayKey(addDays(today, -FORGOTTEN_DAYS));
      const recent = new Set(history.slice(-20));
      const songs = [...songTotals(days).values()]
        .filter((song) => song.plays >= FAVOURITE_PLAYS && song.lastDay < cutoff && !recent.has(song.trackId))
        .sort((a, b) => b.plays - a.plays || a.lastDay.localeCompare(b.lastDay));
      return pick(songs.map((song) => song.trackId));
    }
  }
}
