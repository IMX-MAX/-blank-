import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BUILT_IN_PRESETS,
  EQ_BAND_COUNT,
  EQ_DEFAULT,
  applyPreset,
  biquadDb,
  clampBand,
  clampPreamp,
  editEq,
  effectiveEq,
  eqActive,
  formatDb,
  normaliseEq,
  normalisePresets,
  responseDb,
  saveCustomPreset,
} from './equaliser';

const preset = (id: string) => BUILT_IN_PRESETS.find((item) => item.id === id)!;

test('every preset Nathan asked for is there, with ten bands in range', () => {
  const names = BUILT_IN_PRESETS.map((item) => item.name);
  for (const name of ['Flat', 'Bass Boost', 'Treble Boost', 'Vocal', 'Rock', 'Pop', 'Electronic', 'Hip-Hop', 'Jazz', 'Classical', 'Acoustic', 'Late Night']) {
    assert.ok(names.includes(name), name);
  }
  for (const item of BUILT_IN_PRESETS) {
    assert.equal(item.bands.length, EQ_BAND_COUNT);
    assert.ok(item.bands.every((band) => Math.abs(band) <= 12));
    // Presets that boost leave headroom so they do not clip.
    const peak = Math.max(...item.bands);
    if (peak > 3 && !item.night) assert.ok(item.preamp <= -2, item.name);
  }
});

test('values are clamped and rounded to half a decibel', () => {
  assert.equal(clampBand(13), 12);
  assert.equal(clampBand(-40), -12);
  assert.equal(clampBand(2.26), 2.5);
  assert.equal(clampBand(Number.NaN), 0);
  assert.equal(clampPreamp(9), 6);
  assert.equal(clampPreamp(-20), -12);
});

test('picking a preset and then moving a band makes it custom; moving it back finds the preset again', () => {
  const rock = applyPreset(EQ_DEFAULT, preset('rock'));
  assert.equal(rock.preset, 'rock');
  const nudged = editEq(rock, { band: 3, value: 4 });
  assert.equal(nudged.preset, 'custom');
  assert.equal(nudged.bands[3], 4);
  assert.equal(editEq(nudged, { band: 3, value: preset('rock').bands[3] }).preset, 'rock');
  assert.equal(applyPreset(EQ_DEFAULT, preset('late-night')).night, true);
});

test('switched off, nothing reaches the audio', () => {
  const bass = applyPreset(EQ_DEFAULT, preset('bass-boost'));
  assert.equal(eqActive(bass), true);
  const off = { ...bass, enabled: false };
  assert.equal(eqActive(off), false);
  assert.deepEqual(effectiveEq(off), { bands: Array(EQ_BAND_COUNT).fill(0), preamp: 0, night: false });
  assert.equal(eqActive(EQ_DEFAULT), false);
  // Off keeps the settings for when it is switched back on.
  assert.deepEqual(off.bands, bass.bands);
});

test('the old three-band equaliser carries over', () => {
  const eq = normaliseEq({ bass: 6, mid: 0, treble: -4 });
  assert.deepEqual(eq.bands, [6, 6, 6, 3, 0, 0, 0, -2, -4, -4]);
  assert.equal(eq.enabled, true);
  assert.equal(normaliseEq({ bass: 0, mid: 0, treble: 0 }).preset, 'flat');
  assert.deepEqual(normaliseEq('rubbish'), { ...EQ_DEFAULT });
  const saved = normaliseEq({ enabled: false, bands: [1, 2, 'x'], preamp: -3, preset: 'pop' });
  assert.equal(saved.enabled, false);
  assert.deepEqual(saved.bands.slice(0, 4), [1, 2, 0, 0]);
  assert.equal(saved.bands.length, EQ_BAND_COUNT);
});

test('custom presets save, replace by name and survive bad data', () => {
  const eq = editEq(EQ_DEFAULT, { band: 0, value: 5 });
  const first = saveCustomPreset([], 'Car', eq, 'c1');
  assert.equal(first.presets.length, 1);
  assert.equal(first.preset.bands[0], 5);
  const again = saveCustomPreset(first.presets, ' car ', editEq(eq, { band: 1, value: 3 }), 'c2');
  assert.equal(again.presets.length, 1, 'same name replaces');
  assert.equal(again.preset.id, 'c1');
  assert.equal(again.presets[0]!.bands[1], 3);
  assert.deepEqual(normalisePresets([null, { id: 1 }, { id: 'a', name: 'A', bands: [99] }]).map((item) => item.bands[0]), [12]);
  assert.deepEqual(normalisePresets('x'), []);
});

test('the drawn curve matches the filters: a band peaks at its own frequency and flat is flat', () => {
  assert.ok(Math.abs(biquadDb('peaking', 1000, 6, 1000) - 6) < 0.01);
  assert.ok(Math.abs(biquadDb('peaking', 1000, 6, 100)) < 0.3);
  assert.ok(Math.abs(biquadDb('lowshelf', 31, 6, 15) - 6) < 0.6);
  assert.ok(Math.abs(biquadDb('highshelf', 16000, 6, 20000) - 6) < 1.5);
  assert.equal(responseDb(Array(EQ_BAND_COUNT).fill(0), 0, 440), 0);
  assert.equal(responseDb(Array(EQ_BAND_COUNT).fill(0), -3, 440), -3);
  const bass = preset('bass-boost');
  assert.ok(responseDb(bass.bands, bass.preamp, 60) > responseDb(bass.bands, bass.preamp, 4000));
});

test('decibels read the British way with a proper minus sign', () => {
  assert.equal(formatDb(3.5), '+3.5 dB');
  assert.equal(formatDb(-2), '−2 dB');
  assert.equal(formatDb(0), '0 dB');
});
