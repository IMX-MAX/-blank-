/**
 * Listening stats, kept on this phone only. Plays are stored already added up: one record per day, holding per
 * song the number of plays and the time listened, plus the names it had then (so a song deleted later can still
 * be listed). A year of daily listening stays well under a megabyte.
 */

export type SongMeta = { title: string; artist: string; album: string; albumId: string | null };
export type SongDay = SongMeta & { plays: number; ms: number };
export type DayStats = { day: string; songs: Record<string, SongDay> };

/** A play counts after 30 seconds of listening, or half the song when it is shorter than a minute. */
export const PLAY_AFTER_SECONDS = 30;
export const playThreshold = (durationSeconds: number) =>
  durationSeconds > 0 ? Math.min(PLAY_AFTER_SECONDS, durationSeconds / 2) : PLAY_AFTER_SECONDS;

/** Gaps between two readings longer than this are a seek or a stall, not listening. */
const MAX_STEP_SECONDS = 3;

const pad = (value: number) => String(value).padStart(2, '0');

/** The local calendar day, `YYYY-MM-DD`. */
export const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  copy.setDate(copy.getDate() + days);
  return copy;
}

export type Listen = { trackId: string; meta: SongMeta; ms: number; plays: number; at: Date };

export type Sample = {
  trackId: string | null;
  /** Seconds into the song. */
  time: number;
  playing: boolean;
  /** Seconds. */
  duration: number;
  meta: SongMeta;
  now?: Date;
};

/**
 * Turns playback readings (a few a second) into listening time and plays. Only time that actually played
 * counts: seeking forward adds nothing, and a song counts as played once per listen, however it is seeked.
 * Playing a song again from the start (repeat, or going back to it) is a new listen.
 */
export class ListenTracker {
  private trackId: string | null = null;
  private last = 0;
  private listened = 0;
  private counted = false;

  constructor(private readonly emit: (listen: Listen) => void) {}

  observe(sample: Sample): void {
    const now = sample.now ?? new Date();
    if (sample.trackId !== this.trackId) {
      this.trackId = sample.trackId;
      this.reset(sample.time);
      return;
    }
    if (!this.trackId) return;
    if (sample.time < this.last - 5 && sample.time < 3) {
      // Back at the start: repeat-one, or the song picked again.
      this.reset(sample.time);
      return;
    }
    const step = sample.time - this.last;
    this.last = sample.time;
    if (!sample.playing || step <= 0 || step > MAX_STEP_SECONDS) return;
    this.listened += step;
    let plays = 0;
    if (!this.counted && this.listened >= playThreshold(sample.duration)) {
      this.counted = true;
      plays = 1;
    }
    this.emit({ trackId: this.trackId, meta: sample.meta, ms: Math.round(step * 1000), plays, at: now });
  }

  private reset(time: number) {
    this.last = time;
    this.listened = 0;
    this.counted = false;
  }
}

/** Adds listens into day records (changed in place, created when missing). */
export function mergeListens(days: Map<string, DayStats>, listens: Listen[]): Map<string, DayStats> {
  for (const listen of listens) {
    const day = dayKey(listen.at);
    const record = days.get(day) ?? { day, songs: {} };
    const song = record.songs[listen.trackId] ?? { ...listen.meta, plays: 0, ms: 0 };
    record.songs[listen.trackId] = { ...song, ...listen.meta, plays: song.plays + listen.plays, ms: song.ms + listen.ms };
    days.set(day, record);
  }
  return days;
}

export type Period = '7d' | '30d' | 'all';

export type Ranked = { key: string; title: string; subtitle: string; plays: number; ms: number; removed: boolean; trackId?: string; albumId?: string | null };

export type Summary = {
  ms: number;
  plays: number;
  /** Days in the period with any listening. */
  activeDays: number;
  /** Days in a row with listening, up to today (or yesterday, until something plays today). */
  streak: number;
  songs: Ranked[];
  artists: Ranked[];
  albums: Ranked[];
  /** One bar per day, oldest first. */
  daily: Array<{ day: string; ms: number; plays: number }>;
};

/** Longest stretch the all-time chart shows, in days. */
export const ALL_TIME_CHART_DAYS = 90;
const LISTENING_DAY_MS = 30_000;

const byPlays = (a: Ranked, b: Ranked) => b.plays - a.plays || b.ms - a.ms || a.title.localeCompare(b.title);

/** Splits "A, B & C feat. D" into its artists, so a feature counts for each. */
export function splitArtists(artist: string): string[] {
  const names = artist
    .split(/\s*(?:,|&|;|\/|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\bx\b)\s*/i)
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length ? names : [];
}

export function summarise(
  allDays: DayStats[],
  period: Period,
  today: Date,
  library: { trackIds: Set<string>; albumNames: Map<string, string> },
  limit = 10,
): Summary {
  const sorted = [...allDays].sort((a, b) => a.day.localeCompare(b.day));
  const spanDays = period === '7d' ? 7 : period === '30d' ? 30 : 0;
  const from = spanDays ? dayKey(addDays(today, -(spanDays - 1))) : '';
  const todayKey = dayKey(today);
  const inPeriod = sorted.filter((record) => record.day >= from && record.day <= todayKey);

  const songs = new Map<string, Ranked>();
  const artists = new Map<string, Ranked>();
  const albums = new Map<string, Ranked>();
  let ms = 0;
  let plays = 0;
  const dayTotals = new Map<string, { ms: number; plays: number }>();
  for (const record of inPeriod) {
    let dayMs = 0;
    let dayPlays = 0;
    for (const [trackId, song] of Object.entries(record.songs)) {
      ms += song.ms;
      plays += song.plays;
      dayMs += song.ms;
      dayPlays += song.plays;
      const removed = !library.trackIds.has(trackId);
      const entry = songs.get(trackId) ?? { key: trackId, trackId, title: song.title, subtitle: song.artist, plays: 0, ms: 0, removed };
      // The newest names win, so a retagged song shows its current title.
      songs.set(trackId, { ...entry, title: song.title || entry.title, subtitle: song.artist || entry.subtitle, plays: entry.plays + song.plays, ms: entry.ms + song.ms });
      for (const name of splitArtists(song.artist || '')) {
        const key = name.toLowerCase();
        const artist = artists.get(key) ?? { key, title: name, subtitle: '', plays: 0, ms: 0, removed: false };
        artists.set(key, { ...artist, plays: artist.plays + song.plays, ms: artist.ms + song.ms });
      }
      if (song.albumId || song.album) {
        const key = song.albumId ?? `name:${song.album.toLowerCase()}`;
        const current = song.albumId ? library.albumNames.get(song.albumId) : undefined;
        const album = albums.get(key) ?? {
          key,
          albumId: song.albumId,
          title: current ?? song.album,
          subtitle: song.artist,
          plays: 0,
          ms: 0,
          removed: !!song.albumId && current === undefined,
        };
        albums.set(key, { ...album, plays: album.plays + song.plays, ms: album.ms + song.ms });
      }
    }
    dayTotals.set(record.day, { ms: dayMs, plays: dayPlays });
  }

  let chartDays = spanDays;
  if (!chartDays) {
    const first = inPeriod.find((record) => (dayTotals.get(record.day)?.ms ?? 0) > 0)?.day;
    const firstDate = first ? new Date(`${first}T00:00:00`) : today;
    const span = Math.round((addDays(today, 0).getTime() - addDays(firstDate, 0).getTime()) / 86_400_000) + 1;
    chartDays = Math.min(ALL_TIME_CHART_DAYS, Math.max(7, span));
  }
  const daily = Array.from({ length: chartDays }, (_, at) => {
    const day = dayKey(addDays(today, at - (chartDays - 1)));
    return { day, ...(dayTotals.get(day) ?? { ms: 0, plays: 0 }) };
  });

  const listened = new Set(sorted.filter((record) => Object.values(record.songs).some((song) => song.plays > 0 || song.ms >= LISTENING_DAY_MS)).map((record) => record.day));
  let streak = 0;
  let cursor = listened.has(todayKey) ? today : addDays(today, -1);
  while (listened.has(dayKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  return {
    ms,
    plays,
    activeDays: [...dayTotals.values()].filter((day) => day.ms > 0).length,
    streak,
    songs: [...songs.values()].filter((item) => item.plays > 0).sort(byPlays).slice(0, limit),
    artists: [...artists.values()].filter((item) => item.plays > 0).sort(byPlays).slice(0, limit),
    albums: [...albums.values()].filter((item) => item.plays > 0).sort(byPlays).slice(0, limit),
    daily,
  };
}

/* ---------- Per-song totals, for most-played lists and smart playlists ---------- */

export type SongTotal = SongMeta & { trackId: string; plays: number; ms: number; firstDay: string; lastDay: string };

/**
 * Adds up each song over the days given (or only the last `withinDays` days up to `today`). Titles and artists
 * come from the most recent day the song was played.
 */
export function songTotals(days: readonly DayStats[], options: { withinDays?: number; today?: Date } = {}): Map<string, SongTotal> {
  const from = options.withinDays ? dayKey(addDays(options.today ?? new Date(), -(options.withinDays - 1))) : '';
  const totals = new Map<string, SongTotal>();
  for (const record of [...days].sort((a, b) => a.day.localeCompare(b.day))) {
    if (record.day < from) continue;
    for (const [trackId, song] of Object.entries(record.songs)) {
      const total = totals.get(trackId);
      if (total) {
        total.plays += song.plays;
        total.ms += song.ms;
        total.lastDay = record.day;
        Object.assign(total, { title: song.title, artist: song.artist, album: song.album, albumId: song.albumId });
      } else {
        totals.set(trackId, { trackId, title: song.title, artist: song.artist, album: song.album, albumId: song.albumId, plays: song.plays, ms: song.ms, firstDay: record.day, lastDay: record.day });
      }
    }
  }
  return totals;
}

/**
 * Song ids by plays (then listening time, then most recently played), most first. `exists` leaves out songs no
 * longer in the library, for a "most played" playlist.
 */
export function mostPlayed(
  days: readonly DayStats[],
  options: { withinDays?: number; today?: Date; limit?: number; minPlays?: number; exists?: (trackId: string) => boolean } = {},
): string[] {
  const { limit = 50, minPlays = 1, exists } = options;
  return [...songTotals(days, options).values()]
    .filter((song) => song.plays >= minPlays && (!exists || exists(song.trackId)))
    .sort((a, b) => b.plays - a.plays || b.ms - a.ms || b.lastDay.localeCompare(a.lastDay))
    .slice(0, limit)
    .map((song) => song.trackId);
}

/* ---------- Storage: IndexedDB `blank-stats`, one record per day ---------- */

const DB_NAME = 'blank-stats';
const STORE = 'days';
let opened: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'day' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opened = null;
      reject(request.error ?? new Error('Stats storage is unavailable'));
    };
  });
  return opened;
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await open();
  const tx = db.transaction(STORE, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Saving stats failed'));
  });
  const result = await work(tx.objectStore(STORE));
  await done;
  return result;
}

const listeners = new Set<() => void>();
export function onStatsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const changed = () => listeners.forEach((listener) => listener());

/** Adds listens to the stored days. */
export async function saveListens(listens: Listen[]): Promise<void> {
  if (!listens.length) return;
  const dayKeys = [...new Set(listens.map((listen) => dayKey(listen.at)))];
  await transact('readwrite', async (store) => {
    const days = new Map<string, DayStats>();
    for (const day of dayKeys) {
      const record = (await wrap(store.get(day))) as DayStats | undefined;
      if (record && typeof record.songs === 'object') days.set(day, record);
    }
    mergeListens(days, listens);
    for (const day of dayKeys) await wrap(store.put(days.get(day)!));
  });
  changed();
}

/** Stored days, oldest first; with `fromDay` (YYYY-MM-DD) only that day onwards, read by key range. */
export async function loadStats(fromDay?: string): Promise<DayStats[]> {
  const range = fromDay ? IDBKeyRange.lowerBound(fromDay) : undefined;
  const all = await transact('readonly', (store) => wrap(store.getAll(range) as IDBRequest<DayStats[]>));
  return all.filter((record) => record && typeof record.day === 'string' && record.songs && typeof record.songs === 'object');
}

export async function resetStats(): Promise<void> {
  await transact('readwrite', (store) => wrap(store.clear()));
  changed();
}
