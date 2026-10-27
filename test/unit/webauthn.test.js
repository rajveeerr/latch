import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAssertion, checkRegistration, derToRaw, b64u, newChallenge } from '../../src/lib/webauthn.js';

const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const RP_ID = 'abcdefghijklmnopabcdefghijklmnop';
const sha256 = async (data) => new Uint8Array(await crypto.subtle.digest('SHA-256', data));

// Raw r||s -> DER, the shape authenticators actually return.
function rawToDer(raw) {
  const trim = (part) => {
    let v = Array.from(part);
    while (v.length > 1 && v[0] === 0) v.shift();
    if (v[0] & 0x80) v.unshift(0);
    return [0x02, v.length, ...v];
  };
  const body = [...trim(raw.slice(0, 32)), ...trim(raw.slice(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}

async function makeAuthenticator() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = b64u.encode(await crypto.subtle.exportKey('spki', pair.publicKey));
  async function sign({ challenge, origin = ORIGIN, rpId = RP_ID, flags = 0x05, type = 'webauthn.get' }) {
    const rpHash = await sha256(new TextEncoder().encode(rpId));
    const authData = new Uint8Array([...rpHash, flags, 0, 0, 0, 1]);
    const clientData = new TextEncoder().encode(JSON.stringify({ type, challenge, origin }));
    const signed = new Uint8Array([...authData, ...(await sha256(clientData))]);
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, signed));
    return { authenticatorData: b64u.encode(authData), clientDataJSON: b64u.encode(clientData), signature: b64u.encode(rawToDer(raw)) };
  }
  return { publicKey, sign };
}

const verify = (publicKey, challenge, assertion, over = {}) =>
  verifyAssertion({ publicKey, expectedChallenge: challenge, expectedOrigin: ORIGIN, expectedRpId: RP_ID, assertion, ...over });

test('a correct sign-in for the right challenge is accepted', async () => {
  const device = await makeAuthenticator();
  const challenge = newChallenge();
  assert.deepEqual(await verify(device.publicKey, challenge, await device.sign({ challenge })), { ok: true });
});

test('a sign-in for a different challenge is refused (no replaying an old one)', async () => {
  const device = await makeAuthenticator();
  const assertion = await device.sign({ challenge: newChallenge() });
  assert.equal((await verify(device.publicKey, newChallenge(), assertion)).error, 'bad-challenge');
});

test('a sign-in from another origin or for another relying party is refused', async () => {
  const device = await makeAuthenticator();
  const challenge = newChallenge();
  assert.equal((await verify(device.publicKey, challenge, await device.sign({ challenge, origin: 'https://evil.example' }))).error, 'bad-origin');
  assert.equal((await verify(device.publicKey, challenge, await device.sign({ challenge, rpId: 'evil.example' }))).error, 'bad-rp');
});

test('a sign-in without user verification (no Touch ID or PIN) is refused', async () => {
  const device = await makeAuthenticator();
  const challenge = newChallenge();
  assert.equal((await verify(device.publicKey, challenge, await device.sign({ challenge, flags: 0x01 }))).error, 'not-verified');
  assert.equal((await verify(device.publicKey, challenge, await device.sign({ challenge, flags: 0x04 }))).error, 'not-verified');
});

test('a sign-in from a different key is refused', async () => {
  const mine = await makeAuthenticator();
  const other = await makeAuthenticator();
  const challenge = newChallenge();
  assert.equal((await verify(mine.publicKey, challenge, await other.sign({ challenge }))).error, 'bad-signature');
});

test('a tampered or garbage response is refused without throwing', async () => {
  const device = await makeAuthenticator();
  const challenge = newChallenge();
  const good = await device.sign({ challenge });
  assert.equal((await verify(device.publicKey, challenge, { ...good, signature: b64u.encode(new Uint8Array(70)) })).ok, false);
  assert.equal((await verify(device.publicKey, challenge, { ...good, clientDataJSON: 'not-json' })).ok, false);
  assert.equal((await verify(device.publicKey, challenge, { ...good, authenticatorData: b64u.encode(new Uint8Array(5)) })).ok, false);
  assert.equal((await verify(device.publicKey, challenge, { ...good, clientDataJSON: b64u.encode(new TextEncoder().encode(JSON.stringify({ type: 'webauthn.create', challenge, origin: ORIGIN }))) })).error, 'bad-client-data');
});

test('DER signatures with sign padding and short integers decode to 64 bytes', () => {
  const r = new Uint8Array(32).fill(0xff);            // high bit set: DER pads it with a zero
  const s = new Uint8Array(32); s[31] = 7;            // leading zeros: DER trims them
  const raw = derToRaw(rawToDer(new Uint8Array([...r, ...s])));
  assert.equal(raw.length, 64);
  assert.deepEqual(Array.from(raw.slice(0, 32)), Array.from(r));
  assert.deepEqual(Array.from(raw.slice(32)), Array.from(s));
});

test('registration checks the ceremony and the key type', () => {
  const challenge = newChallenge();
  const clientDataJSON = b64u.encode(new TextEncoder().encode(JSON.stringify({ type: 'webauthn.create', challenge, origin: ORIGIN })));
  const base = { expectedChallenge: challenge, expectedOrigin: ORIGIN, clientDataJSON, algorithm: -7 };
  assert.equal(checkRegistration(base).ok, true);
  assert.equal(checkRegistration({ ...base, algorithm: -257 }).error, 'unsupported-key');
  assert.equal(checkRegistration({ ...base, expectedChallenge: newChallenge() }).error, 'bad-challenge');
  assert.equal(checkRegistration({ ...base, expectedOrigin: 'https://x.example' }).error, 'bad-origin');
});
