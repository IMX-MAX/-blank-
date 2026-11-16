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

// ---------- Messy tags ----------
import { artistInitials, artistSections, isPlaceholderArtist, setFallbackArtist, trackArtists } from './artists';

test('one key for every way an artist is written', () => {
  const same = ['Beyoncé', 'beyonce', '  BEYONCE ', 'Beyonce\u0301', 'Beyonce\u00a0'];
  assert.equal(new Set(same.map(artistKey)).size, 1);
  assert.equal(artistKey('The Harbour'), artistKey('harbour'));
  assert.equal(artistKey('Simon and Garfunkel'), artistKey('Simon & Garfunkel'));
  assert.equal(artistKey('Guns N’ Roses'), artistKey("Guns N' Roses"));
  assert.notEqual(artistKey('Nova Lane'), artistKey('Nova Lanes'));
});

test('bands with commas or "&" are not split, featured artists are', () => {
  assert.deepEqual(splitArtists('Tyler, The Creator'), ['Tyler, The Creator']);
  assert.deepEqual(splitArtists('Tyler, The Creator feat. Kali Uchis'), ['Tyler, The Creator', 'Kali Uchis']);
  assert.deepEqual(splitArtists('Earth, Wind & Fire'), ['Earth, Wind & Fire']);
  assert.deepEqual(splitArtists('Florence + The Machine'), ['Florence + The Machine']);
  assert.deepEqual(splitArtists('Hootie & the Blowfish'), ['Hootie & the Blowfish']);
  assert.deepEqual(splitArtists('Nova Lane ft Juniper'), ['Nova Lane', 'Juniper']);
  assert.deepEqual(splitArtists('Nova Lane FEAT. Juniper, Ada Vale & Mira'), ['Nova Lane', 'Juniper', 'Ada Vale', 'Mira']);
  assert.deepEqual(splitArtists('Nova Lane (with Juniper) - Remix'), ['Nova Lane', 'Juniper']);
  assert.deepEqual(splitArtists('Nova Lane vs. Juniper'), ['Nova Lane', 'Juniper']);
  assert.deepEqual(splitArtists('Nova Lane + Juniper'), ['Nova Lane', 'Juniper']);
  assert.deepEqual(splitArtists('Lil Nas X'), ['Lil Nas X']);
  assert.deepEqual(splitArtists('Nova Lane feat. nova lane'), ['Nova Lane']);
});

test('"Various Artists", unknown and the stand-in name for untagged songs are not artists', () => {
  setFallbackArtist('Nathan');
  try {
    for (const name of ['Various Artists', 'various artists ', 'VA', 'Unknown Artist', '<unknown>', '', 'Nathan', 'nathan']) assert.ok(isPlaceholderArtist(name), name);
    assert.ok(!isPlaceholderArtist('Nova Lane'));
    assert.deepEqual(trackArtists(track('1', 't', 'Various Artists feat. Juniper', null)), ['Juniper']);
    const albums = [album('va', 'Summer Hits', 'Various Artists'), album('mine', 'untitled project', 'Nathan')];
    assert.deepEqual(artistPage('Various Artists', albums, [track('1', 't', 'Various Artists', 'va')]).tracks, []);
    assert.deepEqual(artistPage('Nathan', albums, [track('2', 'demo', 'Nathan', 'mine')]).tracks, []);
  } finally {
    setFallbackArtist(null);
  }
});

test('a messy library comes out as one artist with the right songs and albums', () => {
  setFallbackArtist('Nathan');
  try {
    const albums = [
      album('a1', 'Blue Hours', 'Nova Lane', 'c1'),
      album('a2', 'Low Tide', 'NOVA LANE ', 'c2'),
      album('va', 'Summer Hits 2024', 'Various Artists', 'c3'),
      album('h', 'Paper Suns', 'The Harbour', 'c4'),
      album('mine', 'untitled project', 'Nathan'),
      album('pl', 'Road Trip', 'Nathan', null, 'playlist'),
    ];
    const tracks = [
      track('1', 'Afterglow', 'Nova Lane', 'a1', 2, 2019),
      track('2', 'tidal', 'nova lane', 'a1', 1, 2019),
      track('3', 'Undertow', 'Nova  Lane', 'a2', 1, 2024),
      track('4', 'Interlude', 'Nathan', 'a2', 2, 2024),
      track('5', 'Summer Song', 'Juniper feat. Nova Lane', 'va', 4, 2024),
      track('6', 'Other Hit', 'Juniper', 'va', 5, 2024),
      track('7', 'Copper Sky', 'The Harbour & Nova Lane', 'h', 1, 2021),
      track('8', 'Demo', 'Nathan', 'mine'),
      track('9', 'Nova Lanes', 'Nova Lanes', 'mine'),
    ];
    const page = artistPage('nova lane', albums, tracks);
    assert.equal(page.name, 'Nova Lane');
    assert.deepEqual(page.albums.map((item) => item.id), ['a2', 'a1']);
    assert.deepEqual(page.appearsOn.map((item) => item.id), ['va', 'h']);
    // Newest album first, track order within it; the untagged interlude on their album counts.
    assert.deepEqual(page.tracks.map((item) => item.id), ['3', '4', '2', '1', '5', '7']);
    const juniper = artistPage('Juniper', albums, tracks);
    assert.deepEqual(juniper.albums, []);
    assert.deepEqual(juniper.appearsOn.map((item) => item.id), ['va']);
    assert.deepEqual(juniper.tracks.map((item) => item.id), ['5', '6']);
    const harbour = artistPage('Harbour', albums, tracks);
    assert.equal(harbour.name, 'The Harbour');
    assert.deepEqual(harbour.tracks.map((item) => item.id), ['7']);
  } finally {
    setFallbackArtist(null);
  }
});

test('a few songs do not repeat themselves on the page', () => {
  const few = artistPage('Nova Lane', [album('a', 'A', 'Nova Lane')], [track('1', 'a', 'Nova Lane', 'a'), track('2', 'b', 'Nova Lane', 'a')]);
  assert.deepEqual(artistSections(few, 2), { mostPlayed: false, albums: true, appearsOn: false, songsLimit: 2 });
  const many = { ...few, tracks: Array.from({ length: 20 }, (_, i) => track(String(i), `s${i}`, 'Nova Lane', 'a')) };
  assert.equal(artistSections(many, 5).mostPlayed, true);
  assert.equal(artistSections(many, 5).songsLimit, 10);
  assert.equal(artistSections(many, 1).mostPlayed, false);
});

test('initials for an artist with no cover', () => {
  assert.equal(artistInitials('Nova Lane'), 'NL');
  assert.equal(artistInitials('The Harbour'), 'H');
  assert.equal(artistInitials('björk'), 'B');
  assert.equal(artistInitials('!!!'), '?');
});

test('picker search ignores accents', () => {
  const rows = pickerRows('beyonce', [track('1', 'Halo', 'Beyoncé', null)], [], new Set());
  assert.equal(rows.length, 1);
});
