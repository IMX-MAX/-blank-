import assert from 'node:assert/strict';
import { test } from 'node:test';
import { surfaceIsDark } from './system-bars';

test('status bar icons follow the surface under them', () => {
  assert.equal(surfaceIsDark('dark', false), true);
  assert.equal(surfaceIsDark('light', false), false);
  assert.equal(surfaceIsDark('dark', true), true);
  assert.equal(surfaceIsDark('light', true), false);
});
