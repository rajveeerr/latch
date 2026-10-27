import { b64u } from '../src/lib/webauthn.js';
import { mountDial } from './lockdial.js';

const $ = (id) => document.getElementById(id);
const send = (message) => chrome.runtime.sendMessage(message);
const form = $('form'), input = $('passcode'), button = $('unlock');
let countdown;
let calmTimer;
const preview = location.hash === '#preview';       // opened from Settings: nothing real happens here

// The lock reacts to what you do: the dial turns a notch for every character, the lamp glows,
// a wrong guess snaps it back and flashes red, and the shackle lifts when it opens.
const dial = mountDial($('dialVisual'));
let current = 'guard';
const pet = {
  set(next) {
    if (next === current) return;
    current = next;
    if (next === 'growl') dial.wrong();
    else if (next === 'happy') dial.open();
    else if (next === 'guard') dial.calm();
  },
  turn: (length) => dial.turn(length),
  lookAt() {},
};
const calm = (after = 0) => { clearTimeout(calmTimer); calmTimer = setTimeout(() => pet.set(document.activeElement === input && input.value ? 'typing' : 'guard'), after); };

// the lock tilts a touch toward the pointer
const visual = $('dialVisual');
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  let raf = 0;
  window.addEventListener('pointermove', (event) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      visual.style.setProperty('--mx', (event.clientX / innerWidth * 2 - 1).toFixed(3));
      visual.style.setProperty('--my', (event.clientY / innerHeight * 2 - 1).toFixed(3));
    });
  }, { passive: true });
}
let pendingPasscode = '';        // the passcode just set by a reset, used to unlock afterwards

// ---------- clock ----------
function tickClock() {
  const now = new Date();
  const clock = $('clock');
  clock.textContent = '';
  for (const part of new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).formatToParts(now)) {
    if (part.type === 'dayPeriod') {            // AM/PM sits small beside the digits
      const span = document.createElement('span');
      span.className = 'ampm';
      span.textContent = part.value;
      clock.append(span);
    } else if (part.type !== 'literal' || part.value.trim()) {
      clock.append(part.value);
    }
  }
  $('date').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  setTimeout(tickClock, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
}
tickClock();

// ---------- views ----------
function show(view) {
  for (const id of ['viewUnlock', 'viewRecover', 'viewRecovered']) $(id).hidden = id !== view;
  const focus = { viewUnlock: input, viewRecover: $('recoveryCode'), viewRecovered: $('savedCode') }[view];
  pet.set(view === 'viewRecovered' ? 'happy' : 'guard');
  focus.focus();
}
$('forgot').addEventListener('click', () => show('viewRecover'));
for (const id of ['newPass', 'newPass2']) {
  $(id).addEventListener('input', () => pet.set($(id).value ? 'typing' : 'guard'));
  $(id).addEventListener('blur', () => pet.set('guard'));
}
$('backToUnlock').addEventListener('click', () => show('viewUnlock'));

// show / hide on every passcode field
for (const reveal of document.querySelectorAll('.reveal')) {
  reveal.addEventListener('click', () => {
    const field = reveal.parentElement.querySelector('input');
    const showing = field.type === 'password';
    field.type = showing ? 'text' : 'password';
    reveal.setAttribute('aria-label', showing ? 'Hide passcode' : 'Show passcode');
    if (field === input) pet.set(showing ? 'peek' : (input.value ? 'typing' : 'guard'));
    reveal.querySelector('use').setAttribute('href', showing ? 'icons.svg#eye-off' : 'icons.svg#eye');
    field.focus();
  });
}
input.addEventListener('input', () => { pet.set(input.type === 'text' ? 'peek' : (input.value ? 'typing' : 'guard')); pet.turn(input.value.length); });
input.addEventListener('focus', () => { if (input.value) pet.set(input.type === 'text' ? 'peek' : 'typing'); });
input.addEventListener('blur', () => pet.set('guard'));
const caps = (event) => { $('caps').hidden = !event.getModifierState?.('CapsLock'); };
input.addEventListener('keydown', caps);
input.addEventListener('keyup', caps);
window.addEventListener('focus', () => { if (!$('viewUnlock').hidden && !input.disabled) input.focus(); });

// ---------- feedback ----------
function fail(message) {
  pet.set('growl'); calm(1500);
  $('error').textContent = '';
  requestAnimationFrame(() => { $('error').textContent = message; });     // re-announced each time
  input.setAttribute('aria-invalid', 'true');
  const content = document.querySelector('.panel');
  content.classList.remove('shake'); void content.offsetWidth; content.classList.add('shake');
  input.focus(); input.select();
}
input.addEventListener('input', () => { input.removeAttribute('aria-invalid'); if (!input.disabled) $('error').textContent = ''; });

// The countdown is drawn in a silent line so screen readers hear the message once, not every second.
function showWait(ms) {
  clearInterval(countdown);
  const until = Date.now() + ms;
  $('error').textContent = 'Too many attempts. Please wait before trying again.';
  $('error').tabIndex = -1;
  const tick = () => {
    const left = Math.ceil((until - Date.now()) / 1000);
    if (left <= 0) {
      clearInterval(countdown);
      $('countdown').textContent = '';
      $('error').textContent = '';
      input.disabled = false; button.disabled = false; input.focus();
      return;
    }
    $('countdown').textContent = `Try again in ${left}s`;
    if (!input.disabled) { input.disabled = true; button.disabled = true; $('error').focus(); }   // keep keyboard focus on the page, not lost
  };
  tick();
  countdown = setInterval(tick, 500);
}

function done(method) {
  pet.set('happy');
  document.querySelector('.panel').classList.add('done');
  document.querySelector('.stage').classList.add('done');
  $('title').textContent = 'Unlocked';
  $('reason').textContent = 'Restoring your windows…';
  button.disabled = true;
  // If the window does not close by itself, never leave the person stuck here.
  setTimeout(() => { $('reason').textContent = 'You can close this window.'; button.disabled = false; }, 3000);
}

async function init() {
  if (preview) {
    $('title').textContent = 'Lock screen preview';
    $('reason').textContent = 'Nothing is locked. Type anything and press Unlock, or type “wrong”.';
    document.querySelector('.alts').hidden = true;
    return;
  }
  const status = await send({ type: 'getStatus' });
  if (status.reason) $('reason').textContent = status.reason + '.';
  if (status.scope === 'private') $('footText').textContent = 'Only your private windows are locked. Everything else stays open.';
  if (status.retryAfterMs) showWait(status.retryAfterMs);
  // A reset already retired the old recovery code, so a new one must not be lost if this window was closed too soon.
  const { pendingRecovery } = await chrome.storage.session.get('pendingRecovery');
  if (pendingRecovery) { $('newCode').textContent = pendingRecovery; show('viewRecovered'); }
  if (status.touchId && window.PublicKeyCredential) {
    try {
      if (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()) $('touchId').hidden = false;
    } catch { /* leave it hidden */ }
  }
}

// ---------- unlock with the passcode ----------
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (button.disabled) return;
  if (preview) {                                        // a safe demo of both reactions
    if (!input.value) return fail('Type anything to see it react, or “wrong” to see the other reaction.');
    const wrong = input.value.toLowerCase() === 'wrong';
    input.value = ''; pet.turn(0);
    if (wrong) return fail('Wrong passcode. Try again.');
    done();
    return void setTimeout(() => location.reload(), 2600);
  }
  if (!input.value) return fail('Type your passcode.');
  button.disabled = true;
  const result = await send({ type: 'unlock', passcode: input.value });
  input.value = '';
  if (result.ok) return done();
  button.disabled = false;
  if (result.retryAfterMs) showWait(result.retryAfterMs);
  else fail(result.error === 'wrong' ? 'Wrong passcode. Try again.' : 'Could not unlock. Please try again.');
});

// ---------- unlock with Touch ID ----------
$('touchId').addEventListener('click', async () => {
  $('error').textContent = '';
  try {
    const begin = await send({ type: 'touchIdChallenge' });
    if (!begin.ok) return fail('Touch ID is not set up. Use your passcode.');
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: b64u.decode(begin.challenge),
        allowCredentials: [{ type: 'public-key', id: b64u.decode(begin.credentialId) }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    const r = credential.response;
    const result = await send({
      type: 'touchIdUnlock',
      assertion: { authenticatorData: b64u.encode(r.authenticatorData), clientDataJSON: b64u.encode(r.clientDataJSON), signature: b64u.encode(r.signature) },
    });
    if (result.ok) return done();
    fail('Touch ID could not confirm it is you. Use your passcode.');
  } catch (err) {
    if (err?.name !== 'NotAllowedError') fail('Touch ID is not available right now. Use your passcode.');   // cancelling is not an error
  }
});

// ---------- forgot the passcode ----------
$('recoverForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = $('recoverError');
  const a = $('newPass').value, b = $('newPass2').value;
  if (!$('recoveryCode').value.trim()) return void (error.textContent = 'Enter your recovery code.');
  if (a.length < 4) return void (error.textContent = 'Use at least 4 characters for the new passcode.');
  if (a !== b) return void (error.textContent = 'The two passcodes differ.');
  $('recoverBtn').disabled = true;
  const result = await send({ type: 'recoverReset', code: $('recoveryCode').value, newPasscode: a });
  $('recoverBtn').disabled = false;
  if (!result.ok) {
    error.textContent = result.error === 'wrong' ? 'That recovery code is not right. Check it and try again.'
      : result.error === 'locked-out' ? `Too many attempts. Wait ${Math.ceil(result.retryAfterMs / 1000)} seconds.`
      : result.error === 'no-passcode' ? 'No recovery code was set up for this profile.'
      : 'Could not reset the passcode.';
    return;
  }
  pendingPasscode = a;
  await chrome.storage.session.set({ pendingRecovery: result.recoveryCode });
  for (const id of ['recoveryCode', 'newPass', 'newPass2']) $(id).value = '';
  error.textContent = '';
  $('newCode').textContent = result.recoveryCode;
  show('viewRecovered');
});

$('copyCode').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('newCode').textContent); $('copyCode').lastChild.textContent = ' Copied'; }
  catch { $('copyCode').lastChild.textContent = ' Select the code and copy it'; }
});
$('savedCode').addEventListener('change', () => { $('finish').disabled = !$('savedCode').checked; });
$('finish').addEventListener('click', async () => {
  $('finish').disabled = true;
  await chrome.storage.session.remove('pendingRecovery');
  const passcode = pendingPasscode;
  pendingPasscode = '';
  show('viewUnlock');
  if (!passcode) { $('reason').textContent = 'Use your new passcode to unlock.'; $('finish').disabled = false; return; }
  const result = await send({ type: 'unlock', passcode });
  if (result.ok) done();
  else { $('finish').disabled = false; fail('Use your new passcode to unlock.'); }
});

init();
