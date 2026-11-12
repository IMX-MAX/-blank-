import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HAPTIC_GAPS, HapticGate, LIGHT_AFTER_ANY, detents, type HapticKind } from './haptics-core';

function gate(enabled = true) {
  let time = 1000;
  const sent: HapticKind[] = [];
  const g = new HapticGate((kind) => sent.push(kind), { enabled, now: () => time });
  return { g, sent, advance: (ms: number) => (time += ms) };
}

test('switched off, nothing fires; switched back on, it does', () => {
  const { g, sent } = gate(false);
  assert.equal(g.fire('tap'), false);
  assert.equal(g.fire('success'), false);
  g.enabled = true;
  assert.equal(g.fire('tap'), true);
  assert.deepEqual(sent, ['tap']);
});

test('quick repeats of the same kind are throttled', () => {
  const { g, sent, advance } = gate();
  g.fire('tick');
  advance(HAPTIC_GAPS.tick - 1);
  assert.equal(g.fire('tick'), false);
  advance(1);
  assert.equal(g.fire('tick'), true);
  // Dragging a slider fast for a second gives at most about one tick per gap.
  for (let i = 0; i < 100; i += 1) {
    advance(10);
    g.fire('tick');
  }
  assert.ok(sent.length <= 2 + Math.ceil(1000 / HAPTIC_GAPS.tick));
});

test('a light tap straight after a stronger haptic is dropped, a stronger one is not', () => {
  const { g, sent, advance } = gate();
  g.fire('warning');
  advance(20);
  assert.equal(g.fire('tap'), false, 'the confirm button click');
  advance(LIGHT_AFTER_ANY);
  assert.equal(g.fire('tap'), true);
  advance(10);
  assert.equal(g.fire('success'), true);
  assert.deepEqual(sent, ['warning', 'tap', 'success']);
});

test('slider detents tick once per step, not per pixel', () => {
  const crossed = detents(20);
  assert.equal(crossed(0.5), false, 'where the drag starts');
  assert.equal(crossed(0.51), false);
  assert.equal(crossed(0.53), true);
  assert.equal(crossed(0.54), false);
  assert.equal(crossed(1.4), true);
  assert.equal(crossed(1), false, 'clamped to the end');
});
