// Verifying a Touch ID / device-passkey sign-in (WebAuthn) locally, with no server.
// Registration stores the public key; every unlock checks a fresh signed challenge.

const enc = new TextEncoder();

export const b64u = {
  encode(bytes) {
    let s = '';
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  },
  decode(str) {
    const padded = str.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (str.length % 4)) % 4);
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  },
};

export function newChallenge() {
  return b64u.encode(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256(data) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

// WebAuthn signatures are ASN.1 DER; WebCrypto wants the raw 64-byte r||s form.
export function derToRaw(der) {
  const bytes = new Uint8Array(der);
  if (bytes[0] !== 0x30) throw new Error('bad signature');
  let i = 2;
  if (bytes[1] & 0x80) i += bytes[1] & 0x7f;             // long-form length
  const readInt = () => {
    if (bytes[i++] !== 0x02) throw new Error('bad signature');
    let len = bytes[i++];
    let value = bytes.slice(i, i + len);
    i += len;
    while (value.length > 32 && value[0] === 0) value = value.slice(1);   // strip sign padding
    const out = new Uint8Array(32);
    out.set(value, 32 - value.length);
    return out;
  };
  const r = readInt();
  const s = readInt();
  return new Uint8Array([...r, ...s]);
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;

function parseClientData(clientDataJSON) {
  try { return JSON.parse(new TextDecoder().decode(b64u.decode(clientDataJSON))); } catch { return null; }
}

// Checks what a sign-in must prove: it is for this challenge, this extension, with the
// user present and verified (Touch ID or a device PIN), signed by the key we registered.
export async function verifyAssertion({ publicKey, expectedChallenge, expectedOrigin, expectedRpId, assertion }) {
  const client = parseClientData(assertion.clientDataJSON);
  if (!client || client.type !== 'webauthn.get') return { ok: false, error: 'bad-client-data' };
  if (client.challenge !== expectedChallenge) return { ok: false, error: 'bad-challenge' };
  if (client.origin !== expectedOrigin) return { ok: false, error: 'bad-origin' };

  const authData = b64u.decode(assertion.authenticatorData);
  if (authData.length < 37) return { ok: false, error: 'bad-authenticator-data' };
  if (!sameBytes(authData.slice(0, 32), await sha256(enc.encode(expectedRpId)))) return { ok: false, error: 'bad-rp' };
  const flags = authData[32];
  if (!(flags & FLAG_USER_PRESENT) || !(flags & FLAG_USER_VERIFIED)) return { ok: false, error: 'not-verified' };

  let valid = false;
  try {
    const key = await crypto.subtle.importKey('spki', b64u.decode(publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const signed = new Uint8Array([...authData, ...(await sha256(b64u.decode(assertion.clientDataJSON)))]);
    valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(b64u.decode(assertion.signature)), signed);
  } catch { valid = false; }
  return valid ? { ok: true } : { ok: false, error: 'bad-signature' };
}

// Registration: the browser hands us the new public key; we only need to be sure the ceremony was ours.
export function checkRegistration({ expectedChallenge, expectedOrigin, clientDataJSON, algorithm }) {
  const client = parseClientData(clientDataJSON);
  if (!client || client.type !== 'webauthn.create') return { ok: false, error: 'bad-client-data' };
  if (client.challenge !== expectedChallenge) return { ok: false, error: 'bad-challenge' };
  if (client.origin !== expectedOrigin) return { ok: false, error: 'bad-origin' };
  if (algorithm !== -7) return { ok: false, error: 'unsupported-key' };      // ES256 only
  return { ok: true };
}
