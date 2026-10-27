import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeSettings, isWeakening } from '../../src/lib/settings.js';

test('missing or garbage input falls back to defaults', () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULTS);
  assert.deepEqual(normalizeSettings('nope'), DEFAULTS);
  assert.deepEqual(normalizeSettings({ autoLockMinutes: 'abc', muteTabs: 'yes' }), DEFAULTS);
});

test('minutes are clamped and rounded to half minutes', () => {
  assert.equal(normalizeSettings({ autoLockMinutes: -5 }).autoLockMinutes, 0);
  assert.equal(normalizeSettings({ autoLockMinutes: 0.1 }).autoLockMinutes, 0.5);
  assert.equal(normalizeSettings({ autoLockMinutes: 99999 }).autoLockMinutes, 1440);
  assert.equal(normalizeSettings({ autoLockMinutes: 7.3 }).autoLockMinutes, 7.5);
});

test('unknown keys are dropped', () => {
  assert.equal('evil' in normalizeSettings({ evil: true }), false);
});

test('making things stricter is not weakening', () => {
  assert.equal(isWeakening(DEFAULTS, { ...DEFAULTS, autoLockMinutes: 1 }), false);
  assert.equal(isWeakening({ ...DEFAULTS, autoLockMinutes: 0 }, { ...DEFAULTS, autoLockMinutes: 5 }), false);
  assert.equal(isWeakening({ ...DEFAULTS, lockOnStartup: false }, DEFAULTS), false);
});

test('longer timeouts, turning things off, and turning Latch off are weakening', () => {
  assert.equal(isWeakening(DEFAULTS, { ...DEFAULTS, autoLockMinutes: 30 }), true);
  assert.equal(isWeakening(DEFAULTS, { ...DEFAULTS, autoLockMinutes: 0 }), true);
  assert.equal(isWeakening(DEFAULTS, { ...DEFAULTS, lockOnStartup: false }), true);
  assert.equal(isWeakening(DEFAULTS, { ...DEFAULTS, muteTabs: false }), true);
  assert.equal(isWeakening(DEFAULTS, { ...DEFAULTS, skipWhileAudio: true }), true);
  assert.equal(isWeakening(DEFAULTS, { ...DEFAULTS, enabled: false }), true);
});

test('saving unchanged settings is not weakening', () => {
  assert.equal(isWeakening(DEFAULTS, { ...DEFAULTS }), false);
});
