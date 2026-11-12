import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mosaicCovers, mosaicKey, mosaicLayout } from './mosaic';

type T = { id: string; cover: string | null };
const t = (id: string, cover: string | null): T => ({ id, cover });
const of = (track: T) => track.cover;

test('the first four different covers, in playlist order', () => {
  const list = [t('1', 'a'), t('2', 'a'), t('3', null), t('4', 'b'), t('5', 'c'), t('6', 'b'), t('7', 'd'), t('8', 'e')];
  assert.deepEqual(mosaicCovers(list, of), ['a', 'b', 'c', 'd']);
});

test('fewer covers than four give what there is', () => {
  assert.deepEqual(mosaicCovers([t('1', 'a'), t('2', 'a')], of), ['a']);
  assert.deepEqual(mosaicCovers([t('1', null)], of), []);
  assert.deepEqual(mosaicCovers([], of), []);
});

test('the layout follows the number of covers', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(mosaicLayout), ['none', 'single', 'pair', 'trio', 'grid', 'grid']);
});

test('the key only changes when the covers shown change', () => {
  const before = mosaicCovers([t('1', 'a'), t('2', 'b')], of);
  const reordered = mosaicCovers([t('2', 'b'), t('1', 'a')], of);
  assert.equal(mosaicKey(before), mosaicKey(mosaicCovers([t('1', 'a'), t('3', 'a'), t('2', 'b')], of)));
  assert.notEqual(mosaicKey(before), mosaicKey(reordered));
});
