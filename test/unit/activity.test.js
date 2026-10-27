import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logEvent, getEvents, clearEvents, failuresSinceUnlock, MAX_EVENTS } from '../../src/lib/activity.js';

const memoryStore = () => {
  const data = {};
  return { get: async (k) => data[k], set: async (k, v) => { data[k] = structuredClone(v); } };
};

test('events come back newest first', async () => {
  const store = memoryStore();
  await logEvent(store, 'lock', 'manual', 1);
  await logEvent(store, 'unlock', 'passcode', 2);
  assert.deepEqual((await getEvents(store)).map((e) => e.type), ['unlock', 'lock']);
});

test('the log is capped so it cannot grow forever', async () => {
  const store = memoryStore();
  for (let i = 0; i < MAX_EVENTS + 25; i++) await logEvent(store, 'failed', String(i), i);
  const events = await getEvents(store);
  assert.equal(events.length, MAX_EVENTS);
  assert.equal(events[0].detail, String(MAX_EVENTS + 24));
});

test('clearing empties the log', async () => {
  const store = memoryStore();
  await logEvent(store, 'lock');
  await clearEvents(store);
  assert.deepEqual(await getEvents(store), []);
});

test('failed attempts are counted back to the last successful unlock', () => {
  const newestFirst = [
    { type: 'failed' }, { type: 'lock' }, { type: 'failed' }, { type: 'unlock' }, { type: 'failed' },
  ];
  assert.equal(failuresSinceUnlock(newestFirst), 2);
  assert.equal(failuresSinceUnlock([{ type: 'unlock' }, { type: 'failed' }]), 0);
  assert.equal(failuresSinceUnlock([]), 0);
});
