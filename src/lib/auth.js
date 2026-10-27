// Passcode and recovery-code storage and checking. Pure logic: the caller passes in a
// `store` ({ get(key), set(key, value) }) so this runs in the extension and in tests.

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

async function derive(secret, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
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

async function makeRecord(secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(secret, salt, ITERATIONS);
  return { salt: toB64(salt), hash: toB64(hash), iterations: ITERATIONS, fails: 0, lockoutUntil: 0 };
}

// Shared by passcode and recovery code: check `secret` against the record stored under `key`.
function checkRecord(store, key, secret, now) {
  return serial(async () => {
    const record = await store.get(key);
    if (!record || !record.hash) return { ok: false, error: 'no-passcode' };
    if (record.lockoutUntil > now) return { ok: false, error: 'locked-out', retryAfterMs: record.lockoutUntil - now };
    const attempt = await derive(String(secret ?? ''), fromB64(record.salt), record.iterations);
    if (sameBytes(attempt, fromB64(record.hash))) {
      if (record.fails || record.lockoutUntil) await store.set(key, { ...record, fails: 0, lockoutUntil: 0 });
      return { ok: true };
    }
    const fails = (record.fails || 0) + 1;
    const retryAfterMs = delayAfterFailures(fails);
    await store.set(key, { ...record, fails, lockoutUntil: retryAfterMs ? now + retryAfterMs : 0 });
    return { ok: false, error: 'wrong', retryAfterMs };
  });
}

// ---------- passcode ----------

export async function hasPasscode(store) {
  const auth = await store.get('auth');
  return Boolean(auth && auth.hash);
}

export function verifyPasscode(store, pass, now = Date.now()) {
  return checkRecord(store, 'auth', pass, now);
}

function validNewPasscode(pass) {
  if (typeof pass !== 'string' || pass.length < MIN_LENGTH) return { ok: false, error: 'too-short' };
  if (pass.length > MAX_LENGTH) return { ok: false, error: 'too-long' };
  return { ok: true };
}

// The first passcode needs no `current` and comes with a recovery code, returned once.
// Changing a passcode requires the old one and keeps the recovery code.
export async function setPasscode(store, pass, current) {
  const valid = validNewPasscode(pass);
  if (!valid.ok) return valid;
  const existing = await hasPasscode(store);
  if (existing) {
    const check = await verifyPasscode(store, current);
    if (!check.ok) return check;
  }
  await store.set('auth', await makeRecord(pass));
  const result = { ok: true };
  if (!(await store.get('recovery'))) result.recoveryCode = await createRecoveryCode(store);
  return result;
}

// ---------- recovery code ----------

// 20 characters from a 32-letter alphabet without look-alikes (no 0/O, 1/I): 100 bits.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function formatRecoveryCode(raw) {
  return raw.match(/.{1,4}/g).join('-');
}

export function normalizeRecoveryCode(input) {
  return String(input ?? '').toUpperCase().split('').filter((c) => ALPHABET.includes(c)).join('');
}

export async function createRecoveryCode(store) {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const raw = Array.from(bytes, (b) => ALPHABET[b & 31]).join('');
  await store.set('recovery', await makeRecord(raw));
  return formatRecoveryCode(raw);
}

export function verifyRecoveryCode(store, code, now = Date.now()) {
  return checkRecord(store, 'recovery', normalizeRecoveryCode(code), now);
}

// Forgot the passcode: the recovery code proves ownership, sets a new passcode and is replaced by a fresh one.
export async function resetWithRecovery(store, code, newPass, now = Date.now()) {
  const valid = validNewPasscode(newPass);
  if (!valid.ok) return valid;
  const check = await verifyRecoveryCode(store, code, now);
  if (!check.ok) return check;
  await store.set('auth', await makeRecord(newPass));
  return { ok: true, recoveryCode: await createRecoveryCode(store) };
}

// A new recovery code for someone who still knows the passcode (the old code stops working).
export async function regenerateRecovery(store, current, now = Date.now()) {
  const check = await verifyPasscode(store, current, now);
  if (!check.ok) return check;
  return { ok: true, recoveryCode: await createRecoveryCode(store) };
}
