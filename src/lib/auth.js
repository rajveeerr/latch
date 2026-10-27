// Passcode storage and checking. Pure logic: the caller passes in a `store`
// ({ get(key), set(key, value) }) so this runs in the extension and in tests.

const ITERATIONS = 310000;     // PBKDF2-SHA256
export const MIN_LENGTH = 4;
export const MAX_LENGTH = 128;

const enc = new TextEncoder();

function toB64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

async function derive(pass, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256));
}

// Compare without stopping at the first difference.
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Wrong guesses are slowed down: free for the first two, then 5s, 10s, 20s ... up to 5 minutes.
export function delayAfterFailures(fails) {
  return fails < 3 ? 0 : Math.min(300000, 5000 * 2 ** (fails - 3));
}

// Checks run one at a time so parallel guesses cannot skip the delay.
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export async function hasPasscode(store) {
  const auth = await store.get('auth');
  return Boolean(auth && auth.hash);
}

export function verifyPasscode(store, pass, now = Date.now()) {
  return serial(async () => {
    const auth = await store.get('auth');
    if (!auth || !auth.hash) return { ok: false, error: 'no-passcode' };
    if (auth.lockoutUntil > now) return { ok: false, error: 'locked-out', retryAfterMs: auth.lockoutUntil - now };
    const attempt = await derive(String(pass ?? ''), fromB64(auth.salt), auth.iterations);
    if (sameBytes(attempt, fromB64(auth.hash))) {
      if (auth.fails || auth.lockoutUntil) await store.set('auth', { ...auth, fails: 0, lockoutUntil: 0 });
      return { ok: true };
    }
    const fails = (auth.fails || 0) + 1;
    const retryAfterMs = delayAfterFailures(fails);
    await store.set('auth', { ...auth, fails, lockoutUntil: retryAfterMs ? now + retryAfterMs : 0 });
    return { ok: false, error: 'wrong', retryAfterMs };
  });
}

// First passcode needs no `current`; changing one requires the old one.
export async function setPasscode(store, pass, current) {
  if (typeof pass !== 'string' || pass.length < MIN_LENGTH) return { ok: false, error: 'too-short' };
  if (pass.length > MAX_LENGTH) return { ok: false, error: 'too-long' };
  if (await hasPasscode(store)) {
    const check = await verifyPasscode(store, current);
    if (!check.ok) return check;
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pass, salt, ITERATIONS);
  await store.set('auth', { salt: toB64(salt), hash: toB64(hash), iterations: ITERATIONS, fails: 0, lockoutUntil: 0 });
  return { ok: true };
}
