import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dropTarget, edgeScrollSpeed, occurrenceKeys, shiftFor, swipeRemoves } from './drag-reorder';

test('a dragged row lands on the nearest slot, inside the list', () => {
  assert.equal(dropTarget(2, 0, 60, 6), 2);
  assert.equal(dropTarget(2, 29, 60, 6), 2);
  assert.equal(dropTarget(2, 31, 60, 6), 3);
  assert.equal(dropTarget(2, -125, 60, 6), 0);
  assert.equal(dropTarget(2, 1000, 60, 6), 5);
  assert.equal(dropTarget(0, 50, 0, 6), 0);
});

test('rows between the start and the drop move aside by one row', () => {
  // Dragging row 1 down to 3: rows 2 and 3 move up.
  assert.deepEqual([0, 1, 2, 3, 4].map((at) => shiftFor(at, 1, 3, 60)), [0, 0, -60, -60, 0]);
  // Dragging row 3 up to 1: rows 1 and 2 move down.
  assert.deepEqual([0, 1, 2, 3, 4].map((at) => shiftFor(at, 3, 1, 60)), [0, 60, 60, 0, 0]);
  assert.deepEqual([0, 1, 2].map((at) => shiftFor(at, 1, 1, 60)), [0, 0, 0]);
});

test('the list scrolls faster nearer its edges while dragging', () => {
  assert.equal(edgeScrollSpeed(300, 0, 600), 0);
  assert.ok(edgeScrollSpeed(10, 0, 600) < edgeScrollSpeed(40, 0, 600));
  assert.ok(edgeScrollSpeed(40, 0, 600) < 0);
  assert.equal(edgeScrollSpeed(-20, 0, 600), -14);
  assert.ok(edgeScrollSpeed(590, 0, 600) > 0);
});

test('a swipe removes past a third of the width or when flicked', () => {
  assert.equal(swipeRemoves(-100, 400, 0), false);
  assert.equal(swipeRemoves(-150, 400, 0), true);
  assert.equal(swipeRemoves(-60, 400, -1), true);
  assert.equal(swipeRemoves(-20, 400, -2), false);
  assert.equal(swipeRemoves(150, 400, 1), false);
});

test('keys stay unique and stable for songs queued twice', () => {
  assert.deepEqual(occurrenceKeys(['a', 'b', 'a', 'a']), ['a', 'b', 'a#1', 'a#2']);
});
