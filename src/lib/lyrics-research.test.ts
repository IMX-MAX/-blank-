import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Lyrics, LyricsHit } from './lyric-types';
import { previewLines, researchLyrics, type ResearchSource } from './lyrics-research';

const lyrics = (mode: Lyrics['mode'], ...text: string[]): Lyrics => ({
  mode,
  source: 'lrclib',
  lines: text.map((line, index) => ({ text: line, start: index, end: index + 1, words: [] })),
});
const hit = (id: string, mode: Lyrics['mode'], meta?: LyricsHit['meta']): LyricsHit => ({ id, lyrics: lyrics(mode, 'one', 'two', 'three', 'four'), meta });
const query = { title: 'Song', artist: 'Band', duration: 200 };

test('every source is asked at once; failures, empty answers and slow sources do not block the rest', async () => {
  const started: string[] = [];
  const sources: ResearchSource[] = [
    { id: 'amll', name: 'AMLL', find: async () => (started.push('amll'), { hits: [hit('1', 'word', { title: 'Song', artist: 'Band' })] }) },
    { id: 'apple', name: 'Apple Music', find: async () => (started.push('apple'), Promise.reject(new Error('HTTP 429'))) },
    { id: 'ncm', name: 'NetEase', find: () => (started.push('ncm'), new Promise(() => undefined)) },
    { id: 'lrclib', name: 'LRCLIB', find: async () => (started.push('lrclib'), { hits: [hit('7', 'line', { duration: 201 }), hit('8', 'plain')] }) },
  ];
  const arrived: string[] = [];
  const rows = await researchLyrics(query, { sources, timeoutMs: 40, onSource: (source) => arrived.push(source.id) });

  assert.deepEqual(started, ['amll', 'apple', 'ncm', 'lrclib'], 'all started before any finished');
  assert.deepEqual(rows.map((row) => [row.source, row.status]), [
    ['amll', 'found'],
    ['apple', 'none'],
    ['ncm', 'none'],
    ['lrclib', 'found'],
    ['lrclib', 'found'],
  ]);
  assert.equal(rows[1]!.error, 'HTTP 429');
  assert.equal(rows[2]!.error, 'Took too long');
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length, 'keys are unique');
  assert.deepEqual(rows[3]!.matched, { duration: 201 });
  assert.equal(rows[0]!.result?.lyrics.mode, 'word');
  assert.equal(arrived.at(-1), 'ncm', 'the slow source arrives last, the others were reported earlier');
});

test('a source with nothing, or only empty lyrics, is a no-result row; instrumental is reported', async () => {
  const sources: ResearchSource[] = [
    { id: 'amll', name: 'AMLL', find: async () => ({ hits: [] }) },
    { id: 'ncm', name: 'NetEase', find: async () => ({ hits: [{ id: '1', lyrics: lyrics('word') }] }) },
    { id: 'lrclib', name: 'LRCLIB', find: async () => ({ hits: [], instrumental: true }) },
  ];
  const rows = await researchLyrics(query, { sources });
  assert.deepEqual(rows.map((row) => row.status), ['none', 'none', 'instrumental']);
  assert.ok(rows.every((row) => !row.error));
});

test('previews show the first few non-empty lines', () => {
  assert.deepEqual(previewLines(lyrics('line', '', 'a', '  ', 'b', 'c', 'd')), ['a', 'b', 'c']);
});
