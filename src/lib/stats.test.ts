import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ListenTracker,
  dayKey,
  loadStats,
  mergeListens,
  mostPlayed,
  songTotals,
  playThreshold,
  resetStats,
  saveListens,
  splitArtists,
  summarise,
  type DayStats,
  type Listen,
  type SongMeta,
} from './stats';

const meta = (title: string, artist = 'Band', album = 'Record', albumId: string | null = 'al1'): SongMeta => ({ title, artist, album, albumId });

/** Plays `seconds` of a song in quarter-second readings starting at `from`. */
function play(tracker: ListenTracker, trackId: string, from: number, seconds: number, duration = 200, at = new Date(2026, 10, 11, 12)) {
  for (let t = from; t <= from + seconds + 1e-9; t += 0.25) tracker.observe({ trackId, time: t, playing: true, duration, meta: meta(trackId), now: at });
}

const collect = () => {
  const listens: Listen[] = [];
  return { listens, tracker: new ListenTracker((listen) => listens.push(listen)) };
};
const plays = (listens: Listen[]) => listens.reduce((sum, listen) => sum + listen.plays, 0);
const ms = (listens: Listen[]) => listens.reduce((sum, listen) => sum + listen.ms, 0);

test('a play counts after 30 seconds, or half a short song, whichever comes first', () => {
  assert.equal(playThreshold(200), 30);
  assert.equal(playThreshold(40), 20);
  assert.equal(playThreshold(0), 30);
  const { listens, tracker } = collect();
  play(tracker, 'a', 0, 29);
  assert.equal(plays(listens), 0);
  play(tracker, 'a', 29.25, 2);
  assert.equal(plays(listens), 1);
  play(tracker, 'a', 31.5, 100);
  assert.equal(plays(listens), 1, 'one listen is one play');
  const short = collect();
  play(short.tracker, 'b', 0, 21, 40);
  assert.equal(plays(short.listens), 1);
});

test('only time actually played counts: seeking forward and pausing add nothing', () => {
  const { listens, tracker } = collect();
  play(tracker, 'a', 0, 10);
  tracker.observe({ trackId: 'a', time: 150, playing: true, duration: 200, meta: meta('a') });
  play(tracker, 'a', 150, 10);
  tracker.observe({ trackId: 'a', time: 161, playing: false, duration: 200, meta: meta('a') });
  assert.equal(plays(listens), 0, '20 s listened, the seek does not count');
  assert.ok(Math.abs(ms(listens) - 20_000) < 600);
});

test('starting the song again, or another song, is a new listen', () => {
  const { listens, tracker } = collect();
  play(tracker, 'a', 0, 40);
  play(tracker, 'a', 0, 40);
  play(tracker, 'b', 0, 5);
  play(tracker, 'a', 0, 31);
  assert.equal(plays(listens.filter((listen) => listen.trackId === 'a')), 3);
  assert.equal(plays(listens.filter((listen) => listen.trackId === 'b')), 0);
});

test('listens add up per song per day', () => {
  const day1 = new Date(2026, 10, 10, 23, 59);
  const day2 = new Date(2026, 10, 11, 0, 1);
  const days = mergeListens(new Map(), [
    { trackId: 'a', meta: meta('A'), ms: 1000, plays: 1, at: day1 },
    { trackId: 'a', meta: meta('A'), ms: 2000, plays: 0, at: day1 },
    { trackId: 'a', meta: meta('A (remaster)'), ms: 500, plays: 1, at: day2 },
  ]);
  assert.deepEqual([...days.keys()], ['2026-11-10', '2026-11-11']);
  assert.equal(days.get('2026-11-10')!.songs.a!.ms, 3000);
  assert.equal(days.get('2026-11-10')!.songs.a!.plays, 1);
  assert.equal(days.get('2026-11-11')!.songs.a!.title, 'A (remaster)');
});

const day = (date: Date, songs: Record<string, { plays: number; ms: number; meta: SongMeta }>): DayStats => ({
  day: dayKey(date),
  songs: Object.fromEntries(Object.entries(songs).map(([id, song]) => [id, { ...song.meta, plays: song.plays, ms: song.ms }])),
});

test('the summary ranks songs, artists and albums for the period and marks removed songs', () => {
  const today = new Date(2026, 10, 11, 15);
  const back = (n: number) => new Date(2026, 10, 11 - n, 12);
  const days = [
    day(back(0), { a: { plays: 3, ms: 600_000, meta: meta('A', 'Band feat. Guest') }, b: { plays: 1, ms: 200_000, meta: meta('B', 'Other', 'Single', 'al2') } }),
    day(back(1), { a: { plays: 1, ms: 200_000, meta: meta('A', 'Band feat. Guest') } }),
    day(back(2), { gone: { plays: 5, ms: 900_000, meta: meta('Gone', 'Band', 'Old', 'al-deleted') } }),
    day(back(20), { b: { plays: 9, ms: 1_800_000, meta: meta('B', 'Other', 'Single', 'al2') } }),
  ];
  const library = { trackIds: new Set(['a', 'b']), albumNames: new Map([['al1', 'Record'], ['al2', 'Single (Deluxe)']]) };
  const week = summarise(days, '7d', today, library);
  assert.equal(week.plays, 10);
  assert.equal(week.ms, 1_900_000);
  assert.deepEqual(week.songs.map((song) => song.key), ['gone', 'a', 'b']);
  assert.equal(week.songs[0]!.removed, true);
  assert.equal(week.songs[1]!.removed, false);
  assert.deepEqual(week.artists.map((artist) => [artist.title, artist.plays]), [['Band', 9], ['Guest', 4], ['Other', 1]]);
  assert.equal(week.albums.find((album) => album.key === 'al2')!.title, 'Single (Deluxe)', 'current album name');
  assert.equal(week.albums.find((album) => album.key === 'al-deleted')!.removed, true);
  assert.equal(week.daily.length, 7);
  assert.equal(week.daily[6]!.day, dayKey(today));
  assert.equal(week.daily[6]!.ms, 800_000);
  assert.equal(week.streak, 3);
  assert.equal(week.activeDays, 3);

  const all = summarise(days, 'all', today, library);
  assert.equal(all.songs[0]!.key, 'b');
  assert.equal(all.daily.length, 21, 'all time charts from the first day with music');
  assert.equal(summarise(days, '30d', today, library).plays, 19);
});

test('the streak runs up to yesterday until something plays today, and breaks on a day off', () => {
  const today = new Date(2026, 10, 11, 9);
  const back = (n: number) => new Date(2026, 10, 11 - n, 12);
  const listened = { s: { plays: 1, ms: 60_000, meta: meta('S') } };
  const lib = { trackIds: new Set(['s']), albumNames: new Map() };
  assert.equal(summarise([day(back(1), listened), day(back(2), listened), day(back(4), listened)], '7d', today, lib).streak, 2);
  assert.equal(summarise([day(back(2), listened)], '7d', today, lib).streak, 0);
  assert.equal(summarise([], 'all', today, lib).plays, 0);
});

test('artist names are split on features and collaborations', () => {
  assert.deepEqual(splitArtists('A, B & C feat. D'), ['A', 'B', 'C', 'D']);
  assert.deepEqual(splitArtists('Simon & Garfunkel'), ['Simon', 'Garfunkel']);
  assert.deepEqual(splitArtists(''), []);
});

test('listens are saved by day, added to what is there, and reset clears them', async () => {
  await resetStats();
  const at = new Date(2026, 10, 11, 10);
  await saveListens([{ trackId: 'a', meta: meta('A'), ms: 30_000, plays: 1, at }]);
  await saveListens([{ trackId: 'a', meta: meta('A'), ms: 10_000, plays: 0, at }, { trackId: 'b', meta: meta('B'), ms: 5_000, plays: 0, at }]);
  const stored = await loadStats();
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.songs.a!.ms, 40_000);
  assert.equal(stored[0]!.songs.a!.plays, 1);
  assert.equal(stored[0]!.songs.b!.ms, 5_000);
  await resetStats();
  assert.deepEqual(await loadStats(), []);
});

test('most played lists songs by plays over a window, for smart playlists', () => {
  const today = new Date(2026, 10, 11, 9);
  const back = (n: number) => new Date(2026, 10, 11 - n, 12);
  const days = [
    day(back(0), { a: { plays: 2, ms: 400_000, meta: meta('A') }, b: { plays: 2, ms: 500_000, meta: meta('B') } }),
    day(back(10), { c: { plays: 9, ms: 1_000_000, meta: meta('C') }, a: { plays: 1, ms: 1000, meta: meta('A old') } }),
    day(back(1), { d: { plays: 0, ms: 20_000, meta: meta('D') } }),
  ];
  assert.deepEqual(mostPlayed(days), ['c', 'a', 'b']);
  assert.deepEqual(mostPlayed(days, { withinDays: 7, today }), ['b', 'a']);
  assert.deepEqual(mostPlayed(days, { exists: (id) => id !== 'c', limit: 1 }), ['a']);
  const totals = songTotals(days);
  assert.equal(totals.get('a')!.plays, 3);
  assert.equal(totals.get('a')!.title, 'A', 'latest title');
  assert.equal(totals.get('a')!.firstDay, dayKey(back(10)));
  assert.equal(totals.get('a')!.lastDay, dayKey(back(0)));
});

test('loading from a day reads only that day onwards', async () => {
  await resetStats();
  await saveListens([
    { trackId: 'a', meta: meta('A'), ms: 1000, plays: 0, at: new Date(2026, 9, 1, 12) },
    { trackId: 'a', meta: meta('A'), ms: 1000, plays: 0, at: new Date(2026, 10, 1, 12) },
  ]);
  assert.deepEqual((await loadStats('2026-10-15')).map((record) => record.day), ['2026-11-01']);
  await resetStats();
});
