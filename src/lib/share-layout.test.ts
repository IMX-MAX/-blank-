import assert from 'node:assert/strict';
import { test } from 'node:test';
import { balancedWrap, fitLyrics, lyricsText, toggleSelection, wrap, type Measure } from './share-layout';

const measure: Measure = (text, size) => text.length * size * 0.5;

test('wraps on words and keeps an over-long word on its own row', () => {
  assert.deepEqual(wrap('one two three four', 40, 10, measure), ['one two', 'three', 'four']);
  assert.deepEqual(wrap('supercalifragilistic yes', 50, 10, measure), ['supercalifragilistic', 'yes']);
  assert.deepEqual(wrap('   ', 100, 10, measure), []);
});

test('balanced wrap evens out the rows without adding any', () => {
  const text = 'I walked along the river and the lights';
  const greedy = wrap(text, 180, 10, measure);
  const balanced = balancedWrap(text, 180, 10, measure);
  assert.equal(balanced.length, greedy.length);
  const spread = (rows: string[]) => Math.max(...rows.map((r) => r.length)) - Math.min(...rows.map((r) => r.length));
  assert.ok(spread(balanced) <= spread(greedy));
  assert.equal(balanced.join(' '), text);
});

test('short selections are set big, long ones smaller, and always fit', () => {
  const box = { width: 800, height: 700 };
  const short = fitLyrics(['Hold on'], box, measure, { max: 96, min: 40 });
  const long = fitLyrics(
    ['I walked along the river and the lights were low', 'and every word you said came back to me in waves', 'so I kept on walking till the morning came'],
    box,
    measure,
    { max: 96, min: 40 },
  );
  assert.equal(short.size, 96);
  assert.ok(long.size < short.size);
  assert.ok(long.height <= box.height);
  assert.equal(long.blocks.length, 3);
});

test('copy text puts the song under the lines', () => {
  assert.equal(lyricsText([' one ', 'two'], 'Song', 'Artist'), 'one\ntwo\n\nSong — Artist');
  assert.equal(lyricsText(['one'], 'Song', ''), 'one\n\nSong');
});

test('selection stays in order and stops at three lines', () => {
  let state = toggleSelection([], 5).next;
  state = toggleSelection(state, 2).next;
  assert.deepEqual(state, [2, 5]);
  state = toggleSelection(state, 9).next;
  const fourth = toggleSelection(state, 1);
  assert.equal(fourth.capped, true);
  assert.deepEqual(fourth.next, [2, 5, 9]);
  assert.deepEqual(toggleSelection(state, 5).next, [2, 9]);
});
