import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeLineIndex, lookupCandidates, lyricsFromRecord, parseLrc, parseLyricsfile } from './lyrics';

test('word-synced lyricsfile keeps the record timings', () => {
  const yaml = `version: '1.0'
lines:
  - text: Hello world
    start_ms: 1000
    end_ms: 3000
    words:
      - text: 'Hello '
        start_ms: 1000
      - text: world
        start_ms: 2000
        end_ms: 2800
  - text: Bye
    start_ms: 4000
`;
  const lyrics = parseLyricsfile(yaml)!;
  assert.equal(lyrics.mode, 'word');
  assert.deepEqual(lyrics.lines[0]!.words.map((w) => [w.text, w.start, w.end]), [
    ['Hello ', 1, 2],
    ['world', 2, 2.8],
  ]);
  assert.equal(lyrics.lines[1]!.words.length, 1);
});

test('line-synced lrc gets estimated words that stay inside the line', () => {
  const lyrics = parseLrc('[00:01.00] one two three\n[00:05.50] four\n')!;
  assert.equal(lyrics.mode, 'line');
  const [first] = lyrics.lines;
  assert.equal(first!.words.map((w) => w.text).join('').trim(), 'one two three');
  assert.ok(first!.words.at(-1)!.end <= 5.5 + 1e-9);
  assert.ok(first!.words[0]!.start === 1);
});

test('enhanced lrc word tags are honoured', () => {
  const lyrics = parseLrc('[00:01.00]<00:01.00>one <00:01.50>two\n')!;
  assert.equal(lyrics.mode, 'word');
  assert.equal(lyrics.lines[0]!.words[1]!.start, 1.5);
});

test('record selection and active line lookup', () => {
  assert.equal(lyricsFromRecord({ id: 1, instrumental: true }).status, 'instrumental');
  const found = lyricsFromRecord({ id: 2, plainLyrics: 'a\nb' });
  assert.equal(found.status === 'found' && found.lyrics.mode, 'plain');
  const lyrics = parseLrc('[00:01.00] a\n[00:03.00] b\n')!;
  assert.equal(activeLineIndex(lyrics.lines, 0.5), -1);
  assert.equal(activeLineIndex(lyrics.lines, 3.2), 1);
});

test('video-style titles are reduced to a song and artist', () => {
  const [first] = lookupCandidates("ILLIT (아일릿) 'NOT CUTE ANYMORE’ Official MV", 'HYBE LABELS');
  assert.deepEqual(first, { title: 'NOT CUTE ANYMORE', artist: 'ILLIT' });
  assert.deepEqual(lookupCandidates('Queen - Bohemian Rhapsody (Official Video)', 'QueenVEVO')[0], {
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
  });
  assert.deepEqual(lookupCandidates('Hello', 'Adele')[0], { title: 'Hello', artist: 'Adele' });
});
