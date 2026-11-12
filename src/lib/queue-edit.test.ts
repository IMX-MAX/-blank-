import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advance, moveUpcoming, playOrder, reinsert, removeWithUndo, setShuffle, startQueue, type QueueState } from './queue-order';

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}
const songs = (count: number) => Array.from({ length: count }, (_, index) => `s${index}`);
const order = <T,>(state: QueueState<T>) => playOrder(state);
const now = <T,>(state: QueueState<T>) => playOrder(state)[state.index];

test('dragging an upcoming song moves it in play order, and in the given order without shuffle', () => {
  const state = startQueue(songs(6), 1, false);
  const moved = moveUpcoming(state, 5, 2);
  assert.deepEqual(order(moved), ['s0', 's1', 's5', 's2', 's3', 's4']);
  assert.equal(now(moved), 's1');
  assert.deepEqual(moved.slots, [0, 1, 2, 3, 4, 5], 'still plays in the given order');
  assert.deepEqual(order(moveUpcoming(moved, 2, 5)), songs(6));
  // Turning shuffle on and off keeps the new order.
  assert.deepEqual(order(setShuffle(setShuffle(moved, true, seeded(3)), false)), order(moved));
});

test('dragging in a shuffled queue changes only the shuffled order', () => {
  const state = setShuffle(startQueue(songs(8), 0, false), true, seeded(7));
  const before = order(state);
  const moved = moveUpcoming(state, 1, 6);
  const expected = [...before];
  expected.splice(6, 0, expected.splice(1, 1)[0]!);
  assert.deepEqual(order(moved), expected);
  assert.equal(now(moved), now(state));
  assert.deepEqual(moved.ordered, state.ordered);
  assert.deepEqual(order(setShuffle(moved, false)), songs(8), 'shuffle off is the order given');
  assert.deepEqual(order(advance(moved, 'off', true)!).slice(0, 2), expected.slice(0, 2));
});

test('the song playing and songs already played cannot be dragged, and out-of-range moves do nothing', () => {
  const state = startQueue(songs(5), 2, false);
  assert.equal(moveUpcoming(state, 2, 4), state);
  assert.equal(moveUpcoming(state, 4, 1), state);
  assert.equal(moveUpcoming(state, 3, 9), state);
  assert.equal(moveUpcoming(state, 3, 3), state);
});

test('undo puts a removed song back in the same place in both orders', () => {
  for (const shuffle of [false, true]) {
    let state = startQueue(songs(7), 1, false);
    if (shuffle) state = setShuffle(state, true, seeded(11));
    const result = removeWithUndo(state, 4)!;
    assert.equal(order(result.state).length, 6);
    assert.ok(!order(result.state).includes(order(state)[4]!));
    const back = reinsert(result.state, result.removed);
    assert.deepEqual(order(back), order(state));
    assert.deepEqual(back.ordered, state.ordered);
    assert.equal(back.index, state.index);
  }
});

test('a song queued twice is put back as the right copy', () => {
  const state = startQueue(['a', 'b', 'a', 'c'], 0, false);
  const result = removeWithUndo(state, 2)!;
  assert.deepEqual(order(result.state), ['a', 'b', 'c']);
  assert.deepEqual(order(reinsert(result.state, result.removed)), ['a', 'b', 'a', 'c']);
});

test('undo after playback moved on puts the song straight after the one playing', () => {
  const state = startQueue(songs(6), 0, false);
  const result = removeWithUndo(state, 2)!;
  let later = advance(result.state, 'off', false)!;
  later = advance(later, 'off', false)!;
  assert.equal(now(later), 's3');
  const back = reinsert(later, result.removed);
  assert.equal(now(back), 's3');
  assert.deepEqual(order(back), ['s0', 's1', 's3', 's2', 's4', 's5']);
});

test('several removals undone newest first restore the queue', () => {
  const state = startQueue(songs(6), 0, false);
  const first = removeWithUndo(state, 5)!;
  const second = removeWithUndo(first.state, 1)!;
  const back = reinsert(reinsert(second.state, second.removed), first.removed);
  assert.deepEqual(order(back), songs(6));
});

test('the song playing cannot be removed, and undo into an emptied queue starts a new one', () => {
  const state = startQueue(songs(3), 1, false);
  assert.equal(removeWithUndo(state, 1), null);
  assert.equal(removeWithUndo(state, 7), null);
  const result = removeWithUndo(state, 2)!;
  assert.deepEqual(order(reinsert({ ordered: [], slots: [], index: 0 }, result.removed)), ['s2']);
});
