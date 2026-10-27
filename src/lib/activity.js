// A small local history of what happened to the lock: locks, unlocks, wrong guesses.
// It never leaves the browser and is capped so it cannot grow without bound.

const KEY = 'activity';
export const MAX_EVENTS = 150;

// type: lock | unlock | failed | recovery | pause | resume | setting | touchid
export async function logEvent(store, type, detail = '', now = Date.now()) {
  const events = (await store.get(KEY)) || [];
  events.push({ t: now, type, detail });
  await store.set(KEY, events.slice(-MAX_EVENTS));
}

export async function getEvents(store) {
  return ((await store.get(KEY)) || []).slice().reverse();     // newest first
}

export async function clearEvents(store) {
  await store.set(KEY, []);
}

// Wrong guesses since the last successful unlock, for the "someone tried" notice.
export function failuresSinceUnlock(eventsNewestFirst) {
  let count = 0;
  for (const e of eventsNewestFirst) {
    if (e.type === 'unlock' || e.type === 'recovery') break;
    if (e.type === 'failed') count++;
  }
  return count;
}
