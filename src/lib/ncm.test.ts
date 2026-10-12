import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withEstimatedWords } from './estimate';
import type { TextFetch } from './http';
import { attachReadings, findNcm, parseReadings, parseYrc, restoreSpaces, scoreSong } from './ncm';
import { isStale } from './lyrics';
import type { Lyrics } from './lyric-types';

const YRC = [
  '[0,30](0,30,0) 作词 : Someone',
  '[30,30](30,30,0) 作曲 : Someone',
  '{"t":60,"c":[{"tx":"制作人: "}]}',
  '[1000,2000](1000,500,0)Is (1500,400,0)this (1900,1100,0)real(3000,0,0)?',
  '[4000,1500](4000,700,0)(oh) (4700,800,0)yeah',
].join('\n');

test('yrc words and times are read, credits are dropped', () => {
  const lyrics = parseYrc(YRC)!;
  assert.equal(lyrics.mode, 'word');
  assert.equal(lyrics.source, 'ncm');
  assert.equal(lyrics.lines.length, 2);
  const first = lyrics.lines[0]!;
  assert.equal(first.text, 'Is this real?');
  assert.deepEqual(first.words.map((word) => word.text), ['Is ', 'this ', 'real', '?']);
  assert.equal(first.words[1]!.start, 1.5);
  assert.equal(first.words[1]!.end, 1.9);
  assert.equal(lyrics.lines[1]!.words[0]!.text, '(oh) ');
});

test('readings attach to the line that starts at the same time', () => {
  const lyrics = attachReadings(parseYrc(YRC)!, parseReadings('[00:01.05]ijeun jinjja\n[00:04.00]o ye'));
  assert.equal(lyrics.lines[0]!.roman, 'ijeun jinjja');
  assert.equal(lyrics.lines[1]!.roman, 'o ye');
});

test('a different recording is not a match', () => {
  const song = { id: 1, name: 'Bohemian Rhapsody', duration: 355000, artists: [{ name: 'Queen' }] };
  assert.ok(scoreSong(song, 'Bohemian Rhapsody', 'Queen', 354) > 10);
  assert.equal(scoreSong(song, 'Bohemian Rhapsody', 'Queen', 330), -1);
  assert.equal(scoreSong(song, 'Bohemian Rhapsody', 'Someone Else', 354), -1);
  assert.equal(scoreSong(song, 'Another Song', 'Queen', 354), -1);
});

test('the lookup searches, picks the right song and returns its word timing', async () => {
  const asked: string[] = [];
  const get: TextFetch = async (url) => {
    asked.push(url);
    if (url.includes('/search/get')) {
      return JSON.stringify({
        result: {
          songs: [
            { id: 7, name: 'Song (Live)', duration: 300000, artists: [{ name: 'Band' }] },
            { id: 8, name: 'Song', duration: 201000, artists: [{ name: 'Band' }] },
          ],
        },
      });
    }
    return JSON.stringify({ yrc: { lyric: YRC } });
  };
  const found = await findNcm({ title: 'Song', artist: 'Band', duration: 200 }, undefined, get);
  assert.equal(found?.id, 'ncm:8');
  assert.equal(found?.lyrics.lines.length, 2);
  assert.ok(asked.some((url) => url.includes('id=8')));
  assert.ok(!asked.some((url) => url.includes('id=7')));
});

test('a song with only line timing is not taken as word timing', async () => {
  const get: TextFetch = async (url) =>
    url.includes('/search/get')
      ? JSON.stringify({ result: { songs: [{ id: 1, name: 'Song', duration: 200000, artists: [{ name: 'Band' }] }] } })
      : JSON.stringify({ lrc: { lyric: '[00:01.00]Hello' } });
  assert.equal(await findNcm({ title: 'Song', artist: 'Band', duration: 200 }, undefined, get), null);
});

test('estimated words fill each line in order and are marked as estimated', () => {
  const lyrics: Lyrics = {
    mode: 'line',
    source: 'lrclib',
    lines: [
      { text: 'Hello darling friend', start: 10, end: 14, words: [] },
      { text: '愛してる', start: 14, end: 60, words: [] },
    ],
  };
  const out = withEstimatedWords(lyrics);
  assert.equal(out.mode, 'word');
  assert.equal(out.estimated, true);
  const [a, b] = out.lines;
  assert.deepEqual(a!.words.map((word) => word.text), ['Hello ', 'darling ', 'friend']);
  assert.equal(a!.words[0]!.start, 10);
  for (let i = 1; i < a!.words.length; i += 1) assert.ok(a!.words[i]!.start >= a!.words[i - 1]!.end - 1e-9);
  assert.ok(a!.words[2]!.end <= 14 + 1e-9);
  assert.equal(b!.words.length, 4);
  assert.ok(b!.words[3]!.end < 20, 'a line before a long gap is not stretched across the gap');
  assert.equal(withEstimatedWords(out), out);
});

test('saved copies without word timing are refreshed once', () => {
  const line: Lyrics = { mode: 'line', source: 'lrclib', lines: [] };
  assert.equal(isStale({ status: 'found', id: 1, lyrics: line }), true);
  assert.equal(isStale({ status: 'found', id: 1, lyrics: { ...line, v: 3 } }), false);
  assert.equal(isStale({ status: 'found', id: 1, lyrics: { ...line, mode: 'word' } }), false);
  assert.equal(isStale({ status: 'found', id: 1, lyrics: { ...line, mode: 'word', source: 'amll', v: 1 } }), true);
});

test('run-together words get their spaces back and bracketed ad-libs become backing vocals', () => {
  const yrc = [
    '[1000,3000](1000,500,0)Maybe (1500,500,0)show (2000,500,0)me (2500,500,0)how(3000,500,0)to (3500,500,0)love',
    '[5000,2000](5000,700,0)Sin (5700,700,0)city (6400,300,0)(Oh) ',
    '[8000,1000](8000,500,0)(Ooh (8500,500,0)ooh)',
  ].join('\n');
  const plain = parseReadings('[00:01.00]Maybe show me how to love\n[00:05.00]Sin city (Oh)\n[00:08.00](Ooh ooh)');
  const lyrics = restoreSpaces(parseYrc(yrc)!, plain);
  assert.equal(lyrics.lines[0]!.text, 'Maybe show me how to love');
  assert.deepEqual(lyrics.lines[0]!.words.map((word) => word.text).slice(3, 6), ['how ', 'to ', 'love']);
  const second = lyrics.lines[1]!;
  assert.equal(second.text, 'Sin city');
  assert.equal(second.bg?.text, 'Oh');
  assert.equal(second.bg?.words[0]!.start, 6.4);
  const third = lyrics.lines[2]!;
  assert.equal(third.backing, true);
  assert.equal(third.text, 'Ooh ooh');
});
