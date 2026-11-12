import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SMART_PLAYLISTS, addedAt, buildSmartPlaylist } from './smart-playlists';
import { dayKey, type DayStats } from './stats';

const today = new Date(2026, 10, 11, 12);
const back = (n: number) => new Date(2026, 10, 11 - n, 12);
const track = (id: string, added: string) => ({ id, createdAt: added });
const tracks = [
  track('a', '2026-01-01T10:00:00Z'),
  track('b', '2026-11-10T10:00:00Z'),
  track('c', '2026-06-01T10:00:00Z'),
  track('d', 'not a date'),
  track('e', '2026-11-01T10:00:00Z'),
];
const meta = { title: 't', artist: 'x', album: 'y', albumId: null };
const day = (n: number, songs: Record<string, number>): DayStats => ({
  day: dayKey(back(n)),
  songs: Object.fromEntries(Object.entries(songs).map(([id, plays]) => [id, { ...meta, plays, ms: plays * 180_000 }])),
});
const days = [day(0, { b: 2, e: 1 }), day(5, { c: 4 }), day(60, { a: 9, gone: 20 }), day(45, { c: 1 })];
const ids = (list: { id: string }[]) => list.map((item) => item.id);

test('there are five smart playlists with British names', () => {
  assert.deepEqual(SMART_PLAYLISTS.map((item) => item.name), ['Most Played', 'Recently Added', 'Recently Played', 'Never Played', 'Forgotten Favourites']);
});

test('most played ranks by plays, all time or the last 30 days, leaving out deleted songs', () => {
  assert.deepEqual(ids(buildSmartPlaylist('most-played', { tracks, days, history: [], today })), ['a', 'c', 'b', 'e']);
  assert.deepEqual(ids(buildSmartPlaylist('most-played', { tracks, days, history: [], today, window: '30d' })), ['c', 'b', 'e']);
  assert.equal(buildSmartPlaylist('most-played', { tracks, days, history: [], today, limit: 2 }).length, 2);
});

test('recently added is newest first, with unreadable dates last', () => {
  assert.deepEqual(ids(buildSmartPlaylist('recently-added', { tracks, days: [], history: [] })), ['b', 'e', 'c', 'a', 'd']);
  assert.equal(addedAt(track('x', 'nope')), 0);
});

test('recently played puts the history first, newest first, then older days from stats', () => {
  const list = buildSmartPlaylist('recently-played', { tracks, days, history: ['c', 'e', 'c', 'gone'], today });
  assert.deepEqual(ids(list), ['c', 'e', 'b', 'a']);
});

test('never played is every song with no plays and not in the history', () => {
  assert.deepEqual(ids(buildSmartPlaylist('never-played', { tracks, days, history: [], today })), ['d']);
  assert.deepEqual(ids(buildSmartPlaylist('never-played', { tracks, days: [], history: ['b'], today })), ['e', 'c', 'a', 'd']);
});

test('forgotten favourites are songs played a lot but not for a month', () => {
  assert.deepEqual(ids(buildSmartPlaylist('forgotten', { tracks, days, history: [], today })), ['a']);
  // c was played 5 times, but 5 days ago, so it is not forgotten.
  assert.deepEqual(ids(buildSmartPlaylist('forgotten', { tracks, days, history: ['a'], today })), [], 'just played again');
});
