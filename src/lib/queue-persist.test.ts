import assert from 'node:assert/strict';
import { test } from 'node:test';
import { insertNext, playOrder, setShuffle, startQueue, type QueueState } from './queue-order';
import { HISTORY_KEY, QUEUE_KEY, historyTracks, pushHistory, readHistory, readSavedQueue, restoreQueue, serialiseQueue, writeHistory, writeSavedQueue } from './queue-persist';

type Song = { id: string; title: string };
const library = (count: number): Song[] => Array.from({ length: count }, (_, at) => ({ id: `s${at}`, title: `Song ${at}` }));
const ids = (state: QueueState<Song>) => playOrder(state).map((song) => song.id);
const now = (state: QueueState<Song>) => playOrder(state)[state.index]!.id;

function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

class MemoryStorage {
  map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

test('a shuffled queue comes back with both orders, the shuffle, the song and the position', () => {
  const songs = library(8);
  let state = setShuffle(startQueue(songs, 2, false), true, seeded(1));
  state = { ...state, index: 3 };
  const saved = serialiseQueue(state, true, 83.27, 1000)!;
  assert.equal(saved.trackId, now(state));
  assert.equal(saved.position, 83.3);
  const storage = new MemoryStorage();
  writeSavedQueue(saved, storage);
  const restored = restoreQueue(readSavedQueue(storage), songs)!;
  assert.deepEqual(ids(restored.state), ids(state));
  assert.equal(now(restored.state), now(state));
  assert.equal(restored.shuffle, true);
  assert.equal(restored.position, 83.3);
  // Turning shuffle off after a restore still goes back to the given order.
  assert.deepEqual(ids(setShuffle(restored.state, false)), songs.map((song) => song.id));
});

test('songs deleted since are dropped and the position in the queue stays on the same song', () => {
  const songs = library(6);
  const state = { ...startQueue(songs, 0, false), index: 3 };
  const saved = serialiseQueue(state, false, 12)!;
  const left = songs.filter((song) => song.id !== 's1' && song.id !== 's5');
  const restored = restoreQueue(saved, left)!;
  assert.deepEqual(ids(restored.state), ['s0', 's2', 's3', 's4']);
  assert.equal(now(restored.state), 's3');
  assert.equal(restored.position, 12);
});

test('when the song that was playing is gone, the next one left plays from the start', () => {
  const songs = library(5);
  const saved = serialiseQueue({ ...startQueue(songs, 0, false), index: 2 }, false, 40)!;
  const next = restoreQueue(saved, songs.filter((song) => song.id !== 's2'))!;
  assert.equal(now(next.state), 's3');
  assert.equal(next.position, 0);
  const atEnd = serialiseQueue({ ...startQueue(songs, 0, false), index: 4 }, false, 40)!;
  const previous = restoreQueue(atEnd, songs.filter((song) => song.id !== 's4'))!;
  assert.equal(now(previous.state), 's3');
  assert.equal(restoreQueue(saved, []), null);
});

test('a song queued twice keeps its place', () => {
  const songs = library(3);
  const state = insertNext(startQueue(songs, 0, false), songs[2]!);
  const restored = restoreQueue(serialiseQueue({ ...state, index: 1 }, false, 5), songs)!;
  assert.deepEqual(ids(restored.state), ['s0', 's2', 's1', 's2']);
  assert.equal(restored.state.index, 1);
});

test('broken or missing data gives nothing rather than an error', () => {
  const songs = library(3);
  assert.equal(restoreQueue(null, songs), null);
  assert.equal(restoreQueue('nonsense', songs), null);
  assert.equal(restoreQueue({ v: 2, ordered: ['s0'], slots: [0] }, songs), null);
  assert.equal(restoreQueue({ v: 1, ordered: [1, 2], slots: [0, 1] }, songs), null);
  const storage = new MemoryStorage();
  storage.setItem(QUEUE_KEY, '{not json');
  assert.equal(readSavedQueue(storage), null);
  // A play order that does not fit falls back to the given order, on the song that was playing.
  const fixed = restoreQueue({ v: 1, ordered: ['s0', 's1', 's2'], slots: [0, 0, 7], index: 9, trackId: 's1', shuffle: true, position: -4 }, songs)!;
  assert.deepEqual(ids(fixed.state), ['s0', 's1', 's2']);
  assert.equal(now(fixed.state), 's1');
  assert.equal(fixed.position, 0);
});

test('an empty queue saves nothing, and clearing forgets the saved one', () => {
  assert.equal(serialiseQueue(startQueue<Song>([], 0, false), false, 0), null);
  const storage = new MemoryStorage();
  writeSavedQueue(serialiseQueue(startQueue(library(2), 0, false), false, 0), storage);
  assert.ok(storage.getItem(QUEUE_KEY));
  writeSavedQueue(null, storage);
  assert.equal(storage.getItem(QUEUE_KEY), null);
});

test('the played history keeps recent songs once each in a row, capped, and survives broken data', () => {
  let history: string[] = [];
  for (const id of ['a', 'b', 'b', 'c', 'a']) history = pushHistory(history, id);
  assert.deepEqual(history, ['a', 'b', 'c', 'a']);
  assert.deepEqual(pushHistory(['a', 'b', 'c'], 'd', 3), ['b', 'c', 'd']);
  const storage = new MemoryStorage();
  writeHistory(history, storage);
  assert.deepEqual(readHistory(storage), history);
  storage.setItem(HISTORY_KEY, '[1, "x", null]');
  assert.deepEqual(readHistory(storage), ['x']);
  storage.setItem(HISTORY_KEY, '{oops');
  assert.deepEqual(readHistory(storage), []);
  writeHistory([], storage);
  assert.equal(storage.getItem(HISTORY_KEY), null);
  const byId = new Map(library(3).map((song) => [song.id, song]));
  assert.deepEqual(historyTracks(['s2', 'gone', 's0'], byId).map((song) => song.id), ['s2', 's0']);
});
