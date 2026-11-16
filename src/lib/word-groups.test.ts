import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupProgress, groupWords } from './word-groups';
import { parseLrc } from './lyrics';

const w = (...texts: string[]) => texts.map((text, i) => ({ text, start: i, end: i + 1 }));
const shown = (texts: string[]) => groupWords(texts.map((text) => ({ text }))).map((g) => texts.slice(g.from, g.to).join(''));

test('pieces of one word with no space between them are one word', () => {
  assert.deepEqual(shown(['the ', 'o', 'pen ', 'road']), ['the ', 'open ', 'road']);
  assert.deepEqual(shown(['chasing ', 'ano', 'ther ', 'o', 'dys', 'sey']), ['chasing ', 'another ', 'odyssey']);
  assert.deepEqual(shown(['switch', 'ing ', 'lanes']), ['switching ', 'lanes']);
});

test('spaces before a piece also split words, and punctuation stays with its word', () => {
  assert.deepEqual(shown(['Hel', 'lo', ' world', ',', ' yeah!']), ['Hello', ' world,', ' yeah!']);
  assert.deepEqual(shown(['"Don\'t', ' stop"']), ['"Don\'t', ' stop"']);
  assert.deepEqual(shown(['one']), ['one']);
  assert.deepEqual(groupWords([]), []);
});

test('Chinese and Japanese characters stay separate so the line can still wrap', () => {
  assert.deepEqual(shown(['我', '爱', '你']), ['我', '爱', '你']);
  assert.deepEqual(shown(['さ', 'く', 'ら', 'love']), ['さ', 'く', 'ら', 'love']);
});

test('a source with no spaces at all does not become one unbreakable word', () => {
  const groups = shown(['I', 'can', 'not', 'stop', 'think', 'ing', 'a', 'bout', 'you', 'to', 'night']);
  assert.ok(groups.length >= 2);
  assert.ok(groups.every((g) => g.length <= 24));
});

test('a whole word rises from its first piece to its last', () => {
  const words = w('o', 'pen ');
  const group = groupWords(words)[0]!;
  assert.equal(groupProgress(words, group, -1), 0);
  assert.equal(groupProgress(words, group, 1), 0.5);
  assert.equal(groupProgress(words, group, 2), 1);
});

test('enhanced LRC keeps spaces that sit between timestamps', () => {
  const lyrics = parseLrc('[00:01.00]<00:01.00>the <00:01.40>o<00:01.60>pen<00:01.90> <00:02.00>road');
  const words = lyrics!.lines[0]!.words;
  assert.deepEqual(words.map((word) => word.text), ['the ', 'o', 'pen ', 'road']);
  assert.deepEqual(shown(words.map((word) => word.text)), ['the ', 'open ', 'road']);
});
