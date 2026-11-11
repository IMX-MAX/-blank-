import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  advance,
  fisherYates,
  insertNext,
  jump,
  mapQueue,
  playOrder,
  removeAt,
  retreat,
  setShuffle,
  startQueue,
  type QueueState,
} from './queue-order';

/** A repeatable random source, so failures can be reproduced. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const songs = (count: number) => Array.from({ length: count }, (_, index) => `s${index}`);
const now = <T,>(state: QueueState<T>) => playOrder(state)[state.index];
const sorted = (items: string[]) => [...items].sort();

test('Fisher-Yates keeps every song and gives every order about equally often', () => {
  const random = seeded(1);
  const counts = new Map<string, number>();
  for (let run = 0; run < 6000; run += 1) {
    const order = fisherYates(['a', 'b', 'c'], random).join('');
    counts.set(order, (counts.get(order) ?? 0) + 1);
  }
  assert.equal(counts.size, 6);
  for (const count of counts.values()) assert.ok(count > 850 && count < 1150, `uneven: ${[...counts]}`);
});

test('without shuffle the queue plays in order from the chosen song', () => {
  const state = startQueue(songs(5), 2, false);
  assert.deepEqual(playOrder(state), songs(5));
  assert.equal(now(state), 's2');
});

test('starting shuffled plays the chosen song first, then every other song once', () => {
  const state = startQueue(songs(8), 5, true, seeded(2));
  assert.equal(state.index, 0);
  assert.equal(now(state), 's5');
  assert.deepEqual(sorted(playOrder(state)), sorted(songs(8)));
});

test('starting shuffled with no chosen song does not always open with the first one', () => {
  const random = seeded(3);
  const openers = new Set(Array.from({ length: 40 }, () => now(startQueue(songs(6), undefined, true, random))));
  assert.ok(openers.size > 3);
});

test('turning shuffle on keeps the song playing first and shuffles all the others, earlier ones included', () => {
  const before = startQueue(songs(10), 6, false);
  const after = setShuffle(before, true, seeded(4));
  assert.equal(after.index, 0);
  assert.equal(now(after), 's6');
  assert.deepEqual(sorted(playOrder(after)), sorted(songs(10)));
  assert.notDeepEqual(playOrder(after).slice(1), songs(10).filter((song) => song !== 's6'), 'the rest is actually shuffled');
});

test('turning shuffle off puts the given order back and carries on from the song playing', () => {
  let state = setShuffle(startQueue(songs(10), 0, false), true, seeded(5));
  state = advance(state, 'off', true)!;
  state = advance(state, 'off', true)!;
  const playing = now(state);
  const off = setShuffle(state, false);
  assert.deepEqual(playOrder(off), songs(10));
  assert.equal(now(off), playing);
});

test('a song that is in the queue twice is still told apart when shuffle goes off', () => {
  const list = ['a', 'b', 'a', 'c'];
  let state = startQueue(list, 2, false);
  state = setShuffle(state, true, seeded(6));
  const off = setShuffle(state, false);
  assert.equal(off.index, 2, 'back on the second "a", not the first');
});

test('next goes through the shuffled order with no repeats until every song has played', () => {
  let state: QueueState<string> | null = startQueue(songs(12), 3, true, seeded(7));
  const heard: string[] = [];
  while (state) {
    heard.push(now(state)!);
    state = advance(state, 'off', true);
  }
  assert.equal(heard.length, 12);
  assert.equal(new Set(heard).size, 12);
});

test('previous goes back through what played, and stops at the first song', () => {
  let state = startQueue(songs(6), 0, true, seeded(8));
  const order = playOrder(state);
  state = advance(state, 'off', true)!;
  state = advance(state, 'off', true)!;
  state = retreat(state)!;
  assert.equal(now(state), order[1]);
  state = retreat(state)!;
  assert.equal(now(state), order[0]);
  assert.equal(retreat(state), null);
});

test('repeat all with shuffle plays a fresh order that does not open with the song that just ended', () => {
  const random = seeded(9);
  let state = startQueue(songs(5), 0, true, random);
  for (let round = 0; round < 50; round += 1) {
    state = jump(state, 4);
    const last = now(state);
    const lap = advance(state, 'all', true, random)!;
    assert.equal(lap.index, 0);
    assert.notEqual(now(lap), last);
    assert.deepEqual(sorted(playOrder(lap)), sorted(songs(5)));
    state = lap;
  }
});

test('repeat all without shuffle loops to the top; repeat off stops; a one-song queue loops itself', () => {
  const end = startQueue(songs(3), 2, false);
  assert.equal(now(advance(end, 'all', false)!), 's0');
  assert.equal(advance(end, 'off', false), null);
  assert.equal(now(advance(startQueue(['x'], 0, true), 'all', true)!), 'x');
});

test('play next lands right after the current song in both orders', () => {
  let state = setShuffle(startQueue(songs(6), 2, false), true, seeded(10));
  state = advance(state, 'off', true)!;
  const playing = now(state)!;
  state = insertNext(state, 'new');
  assert.equal(now(state), playing);
  assert.equal(playOrder(state)[state.index + 1], 'new');
  const off = setShuffle(state, false);
  assert.equal(now(off), playing);
  assert.equal(playOrder(off)[off.index + 1], 'new');
  assert.equal(off.ordered.length, 7);
  assert.deepEqual(insertNext(startQueue<string>([], 0, true), 'only'), { ordered: ['only'], slots: [0], index: 0 });
});

test('removing a song takes it out of both orders and keeps the song playing', () => {
  let state = setShuffle(startQueue(songs(6), 0, false), true, seeded(11));
  state = advance(state, 'off', true)!;
  state = advance(state, 'off', true)!;
  const playing = now(state)!;
  const earlier = playOrder(state)[0]!;
  const later = playOrder(state)[4]!;
  state = removeAt(removeAt(state, 4), 0);
  assert.equal(now(state), playing);
  assert.equal(state.index, 1);
  assert.ok(!playOrder(state).includes(earlier) && !playOrder(state).includes(later));
  assert.equal(removeAt(state, state.index), state, 'the song playing stays');
  const off = setShuffle(state, false);
  assert.deepEqual(playOrder(off), songs(6).filter((song) => song !== earlier && song !== later));
  assert.equal(now(off), playing);
});

test('updated songs keep their place', () => {
  const state = setShuffle(startQueue(songs(4), 1, false), true, seeded(12));
  const updated = mapQueue(state, (song) => song.toUpperCase());
  assert.deepEqual(playOrder(updated), playOrder(state).map((song) => song.toUpperCase()));
  assert.equal(updated.index, state.index);
});
