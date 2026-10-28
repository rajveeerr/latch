import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeSettings, isWeakening, covers, overlayStyle } from '../../src/lib/settings.js';

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

test('the scope is validated, and narrowing protection to private windows counts as weakening', () => {
  assert.equal(normalizeSettings({ scope: 'private' }).scope, 'private');
  assert.equal(normalizeSettings({ scope: 'everything' }).scope, 'profile');
  assert.equal(isWeakening(DEFAULTS, { ...DEFAULTS, scope: 'private' }), true);
  assert.equal(isWeakening({ ...DEFAULTS, scope: 'private' }, DEFAULTS), false);
});

test('"everything" covers every window; "private only" covers only private ones', () => {
  const everything = { ...DEFAULTS, scope: 'profile' }, privateOnly = { ...DEFAULTS, scope: 'private' };
  assert.equal(covers(everything, { incognito: false }), true);
  assert.equal(covers(everything, { incognito: true }), true);
  assert.equal(covers(privateOnly, { incognito: false }), false);
  assert.equal(covers(privateOnly, { incognito: true }), true);
  assert.equal(covers(privateOnly, {}), false, 'unknown is treated as not private');
});

test('lock style: the native helper by default, a bad value falls back, and moving to the in-page overlay counts as weakening', () => {
  assert.equal(DEFAULTS.lockStyle, 'native');
  assert.equal(normalizeSettings({ lockStyle: 'window' }).lockStyle, 'window');
  assert.equal(normalizeSettings({ lockStyle: 'overlay' }).lockStyle, 'overlay');
  assert.equal(normalizeSettings({ lockStyle: 'sideways' }).lockStyle, 'native');
  assert.equal(isWeakening(DEFAULTS, { ...DEFAULTS, lockStyle: 'overlay' }), true);
  assert.equal(isWeakening({ ...DEFAULTS, lockStyle: 'window' }, { ...DEFAULTS, lockStyle: 'overlay' }), true);
  assert.equal(isWeakening({ ...DEFAULTS, lockStyle: 'overlay' }, DEFAULTS), false);
  assert.equal(isWeakening(DEFAULTS, { ...DEFAULTS, lockStyle: 'window' }), false);
});

test('helper Touch ID: off by default, a bad value is ignored, and switching it on counts as loosening', () => {
  assert.equal(DEFAULTS.helperTouchId, false);
  assert.equal(normalizeSettings({ helperTouchId: 'yes' }).helperTouchId, false);
  assert.equal(normalizeSettings({ helperTouchId: true }).helperTouchId, true);
  assert.equal(isWeakening(DEFAULTS, { ...DEFAULTS, helperTouchId: true }), true);
  assert.equal(isWeakening({ ...DEFAULTS, helperTouchId: true }, DEFAULTS), false);
});

test('the overlay needs the page cover: without it the lock window is used', () => {
  assert.equal(overlayStyle(DEFAULTS), true);                                   // native falls back to the overlay
  assert.equal(overlayStyle({ ...DEFAULTS, coverPages: false }), false);
  assert.equal(overlayStyle({ ...DEFAULTS, lockStyle: 'window' }), false);
});
