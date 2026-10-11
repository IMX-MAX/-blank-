import assert from 'node:assert/strict';
import test from 'node:test';

import { detectBeats } from './beat-detect';

const RATE = 22050;

function kickTrack(seconds: number, interval: number, first: number, noise = 0.02): { samples: Float32Array; hits: number[] } {
  const samples = new Float32Array(Math.floor(seconds * RATE));
  let seed = 7;
  for (let i = 0; i < samples.length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    samples[i] = ((seed / 0xffffffff) * 2 - 1) * noise;
  }
  const hits: number[] = [];
  for (let t = first; t < seconds - 0.2; t += interval) {
    hits.push(t);
    const start = Math.floor(t * RATE);
    for (let i = 0; i < 0.09 * RATE; i += 1) {
      const decay = Math.exp(-i / (0.03 * RATE));
      samples[start + i] = samples[start + i]! + 0.8 * decay * Math.sin((2 * Math.PI * 60 * i) / RATE);
    }
  }
  return { samples, hits };
}

test('finds a steady kick drum within a few hundredths of a second', () => {
  const { samples, hits } = kickTrack(20, 0.5, 0.3);
  const beats = detectBeats(samples, RATE);
  assert.ok(beats.length >= hits.length - 2, `found ${beats.length} of ${hits.length}`);
  assert.ok(beats.length <= hits.length + 2, `found ${beats.length} for ${hits.length} hits`);
  let matched = 0;
  for (const beat of beats) {
    if (hits.some((hit) => Math.abs(hit - beat.time) < 0.06)) matched += 1;
  }
  assert.ok(matched >= beats.length - 1, `${matched} of ${beats.length} sit on a real hit`);
});

test('keeps hits at least 0.3 seconds apart and strengths in range', () => {
  const { samples } = kickTrack(15, 0.35, 0.2);
  const beats = detectBeats(samples, RATE);
  for (let i = 1; i < beats.length; i += 1) assert.ok(beats[i]!.time - beats[i - 1]!.time >= 0.29);
  for (const beat of beats) assert.ok(beat.strength >= 0.3 && beat.strength <= 1);
});

test('silence and very short clips have no beats', () => {
  assert.deepEqual(detectBeats(new Float32Array(RATE * 5), RATE), []);
  assert.deepEqual(detectBeats(new Float32Array(100), RATE), []);
});
