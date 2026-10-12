import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from '@xmldom/xmldom';
import { parseClock, parseTtml, scoreItem } from './amll';
import { activeLineIndex, lookupCandidates, lyricsFromRecord, parseLrc, parseLyricsfile } from './lyrics';

const xml = (source: string) => new DOMParser().parseFromString(source, 'application/xml') as unknown as Document;

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
  assert.equal(lyrics.lines[1]!.words.length, 0);
});

test('line-synced lrc is not given invented word timings', () => {
  const lyrics = parseLrc('[00:01.00] one two three\n[00:05.50] four\n')!;
  assert.equal(lyrics.mode, 'line');
  assert.equal(lyrics.source, 'lrclib');
  assert.deepEqual(lyrics.lines.map((line) => line.words.length), [0, 0]);
  assert.equal(lyrics.lines[0]!.text, 'one two three');
  assert.equal(lyrics.lines[0]!.end, 5.5);
});

test('a lyricsfile without word timing stays line-synced', () => {
  const lyrics = parseLyricsfile("lines:\n  - text: Hello\n    start_ms: 1000\n  - text: Bye\n    start_ms: 4000\n")!;
  assert.equal(lyrics.mode, 'line');
  assert.ok(lyrics.lines.every((line) => line.words.length === 0));
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

const TTML = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word"><head><metadata><ttm:agent type="person" xml:id="v1"/><ttm:agent type="person" xml:id="v2"/></metadata></head><body><div>
<p begin="27.173" end="28.516" ttm:agent="v1"><span begin="27.173" end="27.407">I&apos;ve</span> <span begin="27.407" end="27.510">been</span> <span begin="27.510" end="28.516">call</span><span ttm:role="x-translation" xml:lang="zh-CN">我一直心存向往</span></p>
<p begin="59.614" end="1:00.752" ttm:agent="v2"><span begin="59.614" end="1:00.326">Oh</span> <span begin="1:00.326" end="1:00.752">oh</span></p>
<p begin="1:02.000" end="1:05.000" ttm:agent="v1"><span begin="1:02.000" end="1:03.000">Sin</span> <span begin="1:03.000" end="1:04.000">city</span><span ttm:role="x-bg" begin="1:04.000" end="1:05.000"><span begin="1:04.000" end="1:05.000">(Oh)</span></span></p>
</div></body></tt>`;

test('ttml clock values', () => {
  assert.equal(parseClock('27.173'), 27.173);
  assert.equal(parseClock('3:14.571'), 194.571);
  assert.equal(parseClock('1:02:03.5'), 3723.5);
  assert.equal(parseClock('250ms'), 0.25);
  assert.equal(parseClock('nope'), null);
});

test('ttml keeps real word timings, drops translations, keeps backing vocals apart and detects duets', () => {
  const lyrics = parseTtml(TTML, xml)!;
  assert.equal(lyrics.mode, 'word');
  assert.equal(lyrics.source, 'amll');
  assert.equal(lyrics.lines.length, 3);
  const [first, second, third] = lyrics.lines;
  assert.equal(first!.text, "I've been call");
  assert.deepEqual(first!.words.map((word) => [word.text, word.start, word.end]), [
    ["I've ", 27.173, 27.407],
    ['been ', 27.407, 27.51],
    ['call', 27.51, 28.516],
  ]);
  assert.equal(first!.align, undefined);
  assert.equal(second!.align, 'right');
  assert.equal(second!.words[1]!.start, 60.326);
  assert.equal(third!.text, 'Sin city');
  assert.equal(third!.words.length, 2);
  assert.deepEqual(third!.bg && [third!.bg.text, third!.bg.start, third!.bg.end], ['Oh', 64, 65]);
  assert.equal(lyrics.v, 2);
});

test('ttml pronunciation: line-level x-roman and per-word amll:roman', () => {
  const lyrics = parseTtml(
    `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:amll="http://www.example.com/ns/amll"><body><div>
<p begin="1.0" end="3.0"><span begin="1.0" end="2.0">二人</span><span begin="2.0" end="3.0">だ</span><span ttm:role="x-roman">fu ta ri da</span></p>
<p begin="4.0" end="6.0"><span begin="4.0" end="5.0" amll:roman="seol">설</span><span begin="5.0" end="6.0" amll:roman="myeong">명</span></p>
</div></body></tt>`,
    xml,
  )!;
  assert.equal(lyrics.lines[0]!.roman, 'fu ta ri da');
  assert.equal(lyrics.lines[0]!.romanGroups, undefined);
  assert.deepEqual(lyrics.lines[1]!.romanGroups, [
    { from: 0, to: 1, text: 'seol' },
    { from: 1, to: 2, text: 'myeong' },
  ]);
});

test('ttml paragraphs that are only backing vocals become small ad-lib lines', () => {
  const lyrics = parseTtml(
    `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div>
<p begin="1.0" end="3.0"><span begin="1.0" end="2.0">Hey</span></p>
<p begin="3.0" end="4.0"><span ttm:role="x-bg" begin="3.0" end="4.0"><span begin="3.0" end="4.0">(ooh)</span></span></p>
</div></body></tt>`,
    xml,
  )!;
  assert.equal(lyrics.lines.length, 2);
  assert.equal(lyrics.lines[1]!.backing, true);
  assert.equal(lyrics.lines[1]!.text, 'ooh');
  assert.equal(lyrics.lines[1]!.bg, undefined);
});

test('ttml without word spans is line-synced, and broken xml is rejected', () => {
  const lines = parseTtml('<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1.0" end="3.0">Hello there</p><p begin="4.0" end="6.0">Bye</p></div></body></tt>', xml)!;
  assert.equal(lines.mode, 'line');
  assert.deepEqual(lines.lines.map((line) => [line.text, line.start, line.words.length]), [['Hello there', 1, 0], ['Bye', 4, 0]]);
  assert.equal(parseTtml('<tt><body><p begin="1">oops</body>', xml), null);
});

test('amll search results must match the song and the artist', () => {
  const item = { id: 1, musicNames: ['Blinding Lights'], artistNames: ['The Weeknd'] };
  assert.ok(scoreItem(item, 'Blinding Lights', 'The Weeknd') > 10);
  assert.ok(scoreItem(item, 'Blinding Lights', '') >= 0);
  assert.equal(scoreItem(item, 'Blinding Lights', 'Someone Else'), -1);
  assert.equal(scoreItem(item, 'Starboy', 'The Weeknd'), -1);
  assert.ok(scoreItem(item, 'blinding lights', 'the weeknd, daft punk') > 10);
});
