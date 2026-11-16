import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Album, Track } from '../types';
import { albumYear, pickerRows } from './library-search';

const album = (id: string, name: string, artist: string, cover: string | null = null, kind: Album['kind'] = 'album'): Album => ({
  id, name, artist, kind, coverFileId: cover, hue: 0, folderId: null, createdAt: '2026-01-01T00:00:00Z',
});
const track = (id: string, title: string, artist: string, albumId: string | null, trackNumber: number | null = null, year: number | null = null): Track => ({
  id, title, artist, albumId, trackNumber, year, audioFileId: `a-${id}`, coverFileId: null, durationMs: 200_000, hue: 0, waveform: null, createdAt: '2026-01-01T00:00:00Z',
});

test('album year is the year most songs carry', () => {
  assert.equal(albumYear([track('1', 'a', 'x', null, 1, 2020), track('2', 'b', 'x', null, 2, 2021), track('3', 'c', 'x', null, 3, 2021)]), 2021);
  assert.equal(albumYear([track('1', 'a', 'x', null, 1, 2022), track('2', 'b', 'x', null, 2, 2020)]), 2020);
  assert.equal(albumYear([track('1', 'a', 'x', null)]), null);
});

test('the library picker searches title, artist and album, and marks songs already in the playlist', () => {
  const albums = [album('a', 'Blue Hours', 'Nova Lane'), album('b', 'Paper Suns', 'The Harbour'), album('pl', 'Blue Mix', 'Me', null, 'playlist')];
  const tracks = [
    track('1', 'Afterglow', 'Nova Lane', 'a', 2),
    track('2', 'Tidal', 'Nova Lane', 'a', 1),
    track('3', 'Lanterns', 'The Harbour', 'b', 1),
    track('4', 'Blue Lanterns', 'The Harbour', 'b', 2),
  ];
  const all = pickerRows('', tracks, albums, new Set(['3']));
  assert.deepEqual(all.map((row) => row.track.id), ['2', '1', '3', '4']);
  assert.deepEqual(all.filter((row) => row.added).map((row) => row.track.id), ['3']);
  // Album name matches; the title match comes first.
  assert.deepEqual(pickerRows('blue', tracks, albums, new Set()).map((row) => row.track.id), ['4', '2', '1']);
  assert.deepEqual(pickerRows('harbour lant', tracks, albums, new Set()).map((row) => row.track.id), ['3', '4']);
  assert.deepEqual(pickerRows('  NOVA ', tracks, albums, new Set()).map((row) => row.track.id), ['2', '1']);
  assert.deepEqual(pickerRows('zzz', tracks, albums, new Set()), []);
  // A playlist's name is not an album to search by.
  assert.deepEqual(pickerRows('mix', tracks, albums, new Set()), []);
});

test('picker search ignores accents', () => {
  const rows = pickerRows('beyonce', [track('1', 'Halo', 'Beyoncé', null)], [], new Set());
  assert.equal(rows.length, 1);
});
