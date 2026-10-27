import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setPasscode, verifyPasscode, hasPasscode, delayAfterFailures } from '../../src/lib/auth.js';

const memoryStore = () => {
  const data = {};
  return { get: async (k) => data[k], set: async (k, v) => { data[k] = structuredClone(v); }, data };
};

test('a passcode is stored as a salted hash, never as text', async () => {
  const store = memoryStore();
  assert.equal(await hasPasscode(store), false);
  assert.deepEqual(await setPasscode(store, 'correct horse'), { ok: true });
  assert.equal(await hasPasscode(store), true);
  assert.ok(!JSON.stringify(store.data).includes('correct horse'));
});

test('the right passcode unlocks and the wrong one does not', async () => {
  const store = memoryStore();
  await setPasscode(store, 'correct horse');
  assert.equal((await verifyPasscode(store, 'correct horse')).ok, true);
  assert.equal((await verifyPasscode(store, 'wrong')).error, 'wrong');
});

test('the same passcode gets a different salt each time', async () => {
  const a = memoryStore(), b = memoryStore();
  await setPasscode(a, 'same');
  await setPasscode(b, 'same');
  assert.notEqual(a.data.auth.salt, b.data.auth.salt);
  assert.notEqual(a.data.auth.hash, b.data.auth.hash);
});

test('wrong guesses are slowed down, and the delay blocks even the right passcode', async () => {
  const store = memoryStore();
  await setPasscode(store, 'secret');
  const now = 1_000_000;
  assert.equal((await verifyPasscode(store, 'x', now)).retryAfterMs, 0);
  assert.equal((await verifyPasscode(store, 'x', now)).retryAfterMs, 0);
  const third = await verifyPasscode(store, 'x', now);
  assert.equal(third.retryAfterMs, 5000);
  const blocked = await verifyPasscode(store, 'secret', now + 1000);
  assert.equal(blocked.error, 'locked-out');
  assert.equal((await verifyPasscode(store, 'secret', now + 6000)).ok, true);
});

test('a correct passcode resets the failure count', async () => {
  const store = memoryStore();
  await setPasscode(store, 'secret');
  await verifyPasscode(store, 'x', 1);
  await verifyPasscode(store, 'secret', 2);
  assert.equal(store.data.auth.fails, 0);
});

test('parallel guesses cannot skip the delay', async () => {
  const store = memoryStore();
  await setPasscode(store, 'secret');
  const results = await Promise.all(Array.from({ length: 10 }, () => verifyPasscode(store, 'x', 1)));
  // Three real guesses, then everything else is refused while the delay runs.
  assert.equal(results.filter((r) => r.error === 'wrong').length, 3);
  assert.equal(results.filter((r) => r.error === 'locked-out').length, 7);
});

test('delays grow and are capped at five minutes', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(delayAfterFailures), [0, 0, 5000, 10000, 20000]);
  assert.equal(delayAfterFailures(50), 300000);
});

test('changing a passcode needs the current one', async () => {
  const store = memoryStore();
  await setPasscode(store, 'first');
  assert.equal((await setPasscode(store, 'second', 'nope')).ok, false);
  assert.equal((await setPasscode(store, 'second', 'first')).ok, true);
  assert.equal((await verifyPasscode(store, 'second')).ok, true);
});

test('too short and too long passcodes are refused', async () => {
  const store = memoryStore();
  assert.equal((await setPasscode(store, 'abc')).error, 'too-short');
  assert.equal((await setPasscode(store, 'x'.repeat(129))).error, 'too-long');
  assert.equal(await hasPasscode(store), false);
});
