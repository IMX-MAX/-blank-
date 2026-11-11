import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GLIDE_MS, RowGlide, STAGGER_MS, glide, staggerFor } from './lyric-spring';

test('the easing starts at 0, ends exactly at 1 and overshoots only a little', () => {
  assert.equal(glide(0), 0);
  assert.equal(glide(1), 1);
  let peak = 0;
  for (let p = 0; p <= 1; p += 0.01) peak = Math.max(peak, glide(p));
  assert.ok(peak > 1 && peak < 1.05, `peak ${peak}`);
});

test('a row starts where it was drawn and settles at its place', () => {
  const rows = new RowGlide<string>();
  rows.shift([{ key: 'a', delay: 0 }], 120, 1000);
  assert.equal(rows.offset('a', 1000), 120);
  assert.ok(rows.offset('a', 1000 + GLIDE_MS / 2) < 30);
  const end = rows.frame(1000 + GLIDE_MS);
  assert.deepEqual(end, [['a', 0]]);
  assert.equal(rows.active, false);
});

test('a new line arriving mid-glide carries on from where the row is drawn, with no jump', () => {
  const rows = new RowGlide<string>();
  rows.shift([{ key: 'a', delay: 0 }], 100, 0);
  const mid = rows.offset('a', 200);
  rows.shift([{ key: 'a', delay: 0 }], 80, 200);
  assert.ok(Math.abs(rows.offset('a', 200) - (mid + 80)) < 1e-9, 'the remaining offset is kept and the new jump added');
  // The old glide's end time no longer matters: the row is still moving after it.
  assert.ok(rows.offset('a', GLIDE_MS + 10) !== 0);
});

test('rows further down wait a little longer, up to a limit, and hold still until they start', () => {
  assert.equal(staggerFor(-3), 0);
  assert.equal(staggerFor(2), 2 * STAGGER_MS);
  assert.equal(staggerFor(50), staggerFor(7));
  const rows = new RowGlide<string>();
  rows.shift([{ key: 'late', delay: staggerFor(3) }], 60, 0);
  assert.equal(rows.offset('late', staggerFor(3) - 1), 60);
  assert.ok(rows.offset('late', staggerFor(3) + 100) < 60);
});

test('clearing stops every glide', () => {
  const rows = new RowGlide<string>();
  rows.shift([{ key: 'a', delay: 0 }, { key: 'b', delay: 45 }], 50, 0);
  assert.deepEqual(rows.clear().sort(), ['a', 'b']);
  assert.equal(rows.active, false);
  assert.equal(rows.offset('a', 10), 0);
});
