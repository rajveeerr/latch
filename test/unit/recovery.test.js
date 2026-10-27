import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setPasscode, verifyPasscode, verifyRecoveryCode, resetWithRecovery, regenerateRecovery, normalizeRecoveryCode, formatRecoveryCode } from '../../src/lib/auth.js';

const memoryStore = () => {
  const data = {};
  return { get: async (k) => data[k], set: async (k, v) => { data[k] = structuredClone(v); }, data };
};

test('the first passcode comes with a recovery code, shown once and stored only as a hash', async () => {
  const store = memoryStore();
  const result = await setPasscode(store, 'first passcode');
  assert.match(result.recoveryCode, /^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);
  assert.ok(!JSON.stringify(store.data).includes(result.recoveryCode.replaceAll('-', '')));
});

test('changing a passcode keeps the same recovery code', async () => {
  const store = memoryStore();
  const { recoveryCode } = await setPasscode(store, 'first passcode');
  const changed = await setPasscode(store, 'second passcode', 'first passcode');
  assert.equal(changed.recoveryCode, undefined);
  assert.equal((await verifyRecoveryCode(store, recoveryCode)).ok, true);
});

test('recovery codes ignore case, spaces and dashes, and never use look-alike characters', async () => {
  const store = memoryStore();
  const { recoveryCode } = await setPasscode(store, 'first passcode');
  const sloppy = recoveryCode.toLowerCase().replaceAll('-', '  ');
  assert.equal((await verifyRecoveryCode(store, sloppy)).ok, true);
  for (let i = 0; i < 20; i++) {
    const s = memoryStore();
    const code = (await setPasscode(s, 'abcd')).recoveryCode;
    assert.ok(!/[01OI]/.test(code), `${code} has a look-alike`);
  }
  assert.equal(normalizeRecoveryCode('ab-12 cd'), 'AB2CD');   // 1 is not in the alphabet, so it is dropped
  assert.equal(formatRecoveryCode('ABCDEFGH'), 'ABCD-EFGH');
});

test('a wrong recovery code is refused and slowed down like a wrong passcode', async () => {
  const store = memoryStore();
  await setPasscode(store, 'first passcode');
  const now = 5000;
  assert.equal((await verifyRecoveryCode(store, 'AAAA-AAAA-AAAA-AAAA-AAAA', now)).error, 'wrong');
  await verifyRecoveryCode(store, 'AAAA-AAAA-AAAA-AAAA-AAAA', now);
  const third = await verifyRecoveryCode(store, 'AAAA-AAAA-AAAA-AAAA-AAAA', now);
  assert.equal(third.retryAfterMs, 5000);
  assert.equal((await verifyRecoveryCode(store, 'AAAA-AAAA-AAAA-AAAA-AAAA', now + 1)).error, 'locked-out');
});

test('the recovery code resets a forgotten passcode and is replaced by a new one', async () => {
  const store = memoryStore();
  const { recoveryCode } = await setPasscode(store, 'first passcode');
  const reset = await resetWithRecovery(store, recoveryCode, 'brand new passcode');
  assert.equal(reset.ok, true);
  assert.notEqual(reset.recoveryCode, recoveryCode);
  assert.equal((await verifyPasscode(store, 'brand new passcode')).ok, true);
  assert.equal((await verifyPasscode(store, 'first passcode')).ok, false);
  assert.equal((await verifyRecoveryCode(store, recoveryCode)).ok, false, 'the old code is spent');
  assert.equal((await verifyRecoveryCode(store, reset.recoveryCode)).ok, true);
});

test('resetting with a wrong code, or a too-short new passcode, changes nothing', async () => {
  const store = memoryStore();
  const { recoveryCode } = await setPasscode(store, 'first passcode');
  assert.equal((await resetWithRecovery(store, 'AAAA-AAAA-AAAA-AAAA-AAAA', 'brand new passcode')).ok, false);
  assert.equal((await resetWithRecovery(store, recoveryCode, 'abc')).error, 'too-short');
  assert.equal((await verifyPasscode(store, 'first passcode')).ok, true);
});

test('a new recovery code needs the passcode and retires the old one', async () => {
  const store = memoryStore();
  const { recoveryCode } = await setPasscode(store, 'first passcode');
  assert.equal((await regenerateRecovery(store, 'nope')).ok, false);
  const fresh = await regenerateRecovery(store, 'first passcode');
  assert.equal(fresh.ok, true);
  assert.equal((await verifyRecoveryCode(store, recoveryCode)).ok, false);
  assert.equal((await verifyRecoveryCode(store, fresh.recoveryCode)).ok, true);
});
