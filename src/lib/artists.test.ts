import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Album, Track } from '../types';
import { albumYear, artistCovers, artistKey, artistPage, knownArtists, pickerRows, splitArtists } from './artists';

const album = (id: string, name: string, artist: string, cover: string | null = null, kind: Album['kind'] = 'album'): Album => ({
  id, name, artist, kind, coverFileId: cover, hue: 0, folderId: null, createdAt: '2026-01-01T00:00:00Z',
});
const track = (id: string, title: string, artist: string, albumId: string | null, trackNumber: number | null = null, year: number | null = null): Track => ({
  id, title, artist, albumId, trackNumber, year, audioFileId: `a-${id}`, coverFileId: null, durationMs: 200_000, hue: 0, waveform: null, createdAt: '2026-01-01T00:00:00Z',
});

test('splits featured and joint credits, main artist first', () => {
  assert.deepEqual(splitArtists('Nova Lane feat. Juniper'), ['Nova Lane', 'Juniper']);
  assert.deepEqual(splitArtists('Nova Lane ft. Juniper & Ada Vale'), ['Nova Lane', 'Juniper', 'Ada Vale']);
  assert.deepEqual(splitArtists('Nova Lane (feat. Juniper)'), ['Nova Lane', 'Juniper']);
  assert.deepEqual(splitArtists('Nova Lane, Juniper'), ['Nova Lane', 'Juniper']);
  assert.deepEqual(splitArtists('Nova Lane x Juniper'), ['Nova Lane', 'Juniper']);
  assert.deepEqual(splitArtists('Nova Lane / Juniper; Ada'), ['Nova Lane', 'Juniper', 'Ada']);
  assert.deepEqual(splitArtists('  Mira   Okafor '), ['Mira Okafor']);
  assert.deepEqual(splitArtists(''), []);
});

test('a known band name with & or "and" is kept whole', () => {
  const known = new Set([artistKey('Simon & Garfunkel')]);
  assert.deepEqual(splitArtists('Simon & Garfunkel', known), ['Simon & Garfunkel']);
  assert.deepEqual(splitArtists('Simon & Garfunkel feat. Juniper', known), ['Simon & Garfunkel', 'Juniper']);
  assert.deepEqual(splitArtists('Earth and Fire'), ['Earth and Fire']);
  assert.deepEqual(splitArtists('Nova and Ada', new Set(['nova', 'ada'])), ['Nova', 'Ada']);
  assert.deepEqual(splitArtists('Nova Lane & Nova Lane'), ['Nova Lane']);
});

test('known artists come from album artists and single-artist songs', () => {
  const known = knownArtists([album('a', 'X', 'Simon & Garfunkel')], [track('1', 't', 'Juniper', null), track('2', 't', 'A, B', null)]);
  assert.ok(known.has('simon & garfunkel'));
  assert.ok(known.has('juniper'));
  assert.ok(!known.has('a, b'));
});

test('an artist page has their albums, the albums they appear on, and every song', () => {
  const albums = [
    album('old', 'Blue Hours', 'Nova Lane', 'c-old'),
    album('new', 'Low Tide', 'Nova Lane', 'c-new'),
    album('other', 'Paper Suns', 'The Harbour', 'c-other'),
    album('pl', 'Road Trip', 'Nathan', null, 'playlist'),
  ];
  const tracks = [
    track('1', 'Afterglow', 'Nova Lane', 'old', 2, 2019),
    track('2', 'Tidal', 'Nova Lane', 'old', 1, 2019),
    track('3', 'Copper Sky', 'The Harbour feat. Nova Lane', 'other', 1, 2021),
    track('4', 'Lanterns', 'The Harbour', 'other', 2, 2021),
    track('5', 'Undertow', 'nova lane', 'new', 1, 2024),
    track('6', 'Untagged', '', 'new', 2, 2024),
  ];
  const page = artistPage('NOVA LANE', albums, tracks);
  assert.equal(page.name, 'Nova Lane');
  assert.deepEqual(page.albums.map((item) => item.id), ['new', 'old']);
  assert.deepEqual(page.appearsOn.map((item) => item.id), ['other']);
  assert.deepEqual(page.tracks.map((item) => item.id), ['5', '6', '2', '1', '3']);
  assert.deepEqual(artistCovers(page), ['c-new', 'c-old', 'c-other']);
  const harbour = artistPage('The Harbour', albums, tracks);
  assert.deepEqual(harbour.tracks.map((item) => item.id), ['3', '4']);
  assert.deepEqual(harbour.appearsOn, []);
  assert.deepEqual(artistPage('Nobody', albums, tracks).tracks, []);
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
