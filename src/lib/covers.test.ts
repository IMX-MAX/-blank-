import assert from 'node:assert/strict';
import test from 'node:test';
import { coverFor } from './covers';
import type { Album, Track } from '../types';

const album = { coverFileId: 'album-cover' } as Album;
const withOwn = { coverFileId: 'song-cover' } as Track;
const without = { coverFileId: null } as Track;

test('uses the album cover by default', () => {
  assert.equal(coverFor(withOwn, album, false), 'album-cover');
  assert.equal(coverFor(without, album, false), 'album-cover');
});

test('prefers the song cover when asked, and falls back to the album', () => {
  assert.equal(coverFor(withOwn, album, true), 'song-cover');
  assert.equal(coverFor(without, album, true), 'album-cover');
  assert.equal(coverFor(without, undefined, true), null);
});
