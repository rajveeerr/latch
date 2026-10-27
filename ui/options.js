import { mountMechanism } from './mechanism.js';
import { b64u } from '../src/lib/webauthn.js';

const $ = (id) => document.getElementById(id);
const send = (message) => chrome.runtime.sendMessage(message);
const BOOLEANS = ['skipWhileAudio', 'lockOnStartup', 'lockOnSystemLock', 'minimizeWindows', 'coverPages', 'pauseMedia', 'muteTabs'];
const NUMBERS = ['autoLockMinutes', 'blurLockMinutes'];

let saved = null;            // settings exactly as the background has them
let status = null;
let mechanism = null;
let pauseMinutes = 15;
let touchAvailable = false;
let toastTimer;

const isMac = /Mac/.test(navigator.platform);
for (const el of document.querySelectorAll('.shortcut')) el.textContent = isMac ? '⌃⇧L' : 'Ctrl+Shift+L';
$('version').textContent = chrome.runtime.getManifest().version;
navigator.brave?.isBrave?.().then((isBrave) => { if (isBrave) for (const el of document.querySelectorAll('.scheme')) el.textContent = 'brave'; });

// ---------- feedback ----------
function toast(text, kind = '') {
  const el = $('saveMsg');
  el.textContent = text;
  el.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 6000 : 2400);
}

function explain(result) {
  switch (result.error) {
    case 'wrong': return 'Wrong passcode.';
    case 'need-passcode': return 'Enter your passcode.';
    case 'locked-out': return `Too many attempts. Wait ${Math.ceil(result.retryAfterMs / 1000)} seconds.`;
    case 'too-short': return 'Use at least 4 characters.';
    case 'too-long': return 'Use at most 128 characters.';
    case 'cancelled': return 'That was cancelled.';
    case 'unsupported': return 'This browser or device does not support Touch ID for Latch.';
    case 'expired': return 'That took too long. Please try again.';
    default: return 'Something went wrong. Please try again.';
  }
}

// ---------- the passcode bar: any change that weakens protection asks here, in place ----------
let gate = null;
function askPasscode(label, apply, onCancel) {
  gate = { apply, onCancel };
  $('authLabel').textContent = label;
  $('authError').textContent = '';
  $('authPasscode').value = '';
  $('authPasscode').removeAttribute('aria-invalid');
  $('authRow').hidden = false;
  $('authPasscode').focus();
}
function closeGate(cancelled) {
  if (cancelled && gate?.onCancel) gate.onCancel();
  gate = null;
  $('authRow').hidden = true;
  $('authPasscode').value = '';
}
$('authRow').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!gate) return;
  const result = await gate.apply($('authPasscode').value);
  if (result?.ok) return closeGate(false);
  $('authError').textContent = '';
  requestAnimationFrame(() => { $('authError').textContent = explain(result || {}); });
  $('authPasscode').setAttribute('aria-invalid', 'true');
  $('authPasscode').value = '';
  $('authPasscode').focus();
});
$('cancelChange').addEventListener('click', () => closeGate(true));
$('authRow').addEventListener('keydown', (event) => { if (event.key === 'Escape') closeGate(true); });

// ---------- form <-> settings ----------
function readForm() {
  const s = { ...saved };
  for (const k of BOOLEANS) s[k] = $(k).checked;
  for (const k of NUMBERS) s[k] = Number($(k).value || 0);
  s.scope = document.querySelector('input[name="scope"]:checked')?.value || saved.scope;
  return s;
}

function writeForm(s) {
  for (const k of BOOLEANS) $(k).checked = s[k];
  for (const k of NUMBERS) $(k).value = s[k] || '';       // zero reads as an empty box, not a stray "0 min"
  $(s.scope === 'private' ? 'scopePrivate' : 'scopeProfile').checked = true;
  syncChips();
}

function syncChips() {
  for (const group of document.querySelectorAll('.chips')) {
    const value = Number($(group.dataset.for).value || 0);
    for (const b of group.querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.v) === value));
  }
}

// ---------- the overview, in plain words ----------
function summarize(s) {
  const what = s.scope === 'private' ? 'Private windows lock' : 'Everything locks';
  const when = [];
  if (s.autoLockMinutes > 0) when.push(`after ${s.autoLockMinutes} min of inactivity`);
  if (s.blurLockMinutes > 0) when.push(`after ${s.blurLockMinutes} min in the background`);
  if (s.lockOnSystemLock) when.push('when the screen locks');
  if (s.lockOnStartup) when.push('when the browser starts');
  if (!when.length) return `${what} only when you press Lock now.`;
  const last = when.pop();
  return `${what} ${when.length ? when.join(', ') + ' and ' : ''}${last}.`;
}

function renderOverview() {
  const dot = $('statusDot');
  dot.className = 'dot';
  const set = (title, summary) => { $('statusText').textContent = title; $('statusSummary').textContent = summary; };
  const privateBlocked = saved.scope === 'private' && !status.incognitoAllowed;
  if (!status.hasPasscode) set('Welcome to Latch', 'Lock this browser profile behind a passcode. It never closes or changes your tabs.');
  else if (!saved.enabled) set('Latch is off', 'Nothing will lock until you turn it back on.');
  else if (status.paused) {
    set('Protection is paused', 'Resume when you are ready. Locking by hand still works.');
    dot.classList.add('warn');
  } else if (privateBlocked) {
    set('Private windows cannot be locked yet', 'Latch is set to protect private windows only, but it is not allowed in them. Allow it to start protecting them.');
    dot.classList.add('warn');
  } else {
    const what = saved.scope === 'private' ? 'Protecting private windows' : 'Protecting this profile';
    set(status.locked ? 'Locked' : what, summarize(saved));
    dot.classList.add('ok');
  }
  const ready = status.hasPasscode && saved.enabled && !privateBlocked;
  $('lockNow').disabled = !ready;
  $('lockNow').title = privateBlocked ? 'Allow Latch in private windows first' : '';
  $('pauseOpen').hidden = !(status.hasPasscode && saved.enabled) || Boolean(status.paused);
  $('resumeNow').hidden = !(status.hasPasscode && saved.enabled && status.paused);
  $('allowPrivate').hidden = !(status.hasPasscode && saved.enabled && privateBlocked);
  $('turnOff').textContent = saved.enabled ? 'Turn off' : 'Turn on';
  $('turnOff').hidden = !status.hasPasscode;
  if (!status.hasPasscode || !saved.enabled || status.paused) $('pauseChoice').hidden = true;
  mechanism.set(Boolean(status.locked), true);
}

// ---------- first-run checklist ----------
async function renderSetup() {
  const { setupHidden } = await chrome.storage.local.get('setupHidden');
  const { recoveryAck } = await chrome.storage.local.get('recoveryAck');
  const card = $('setupCard');
  const first = !status.hasPasscode;
  $('setupIntro').hidden = !first;
  $('steps').hidden = first;
  $('setupTitle').textContent = first ? 'Set a passcode' : 'Getting set up';
  $('setupHide').hidden = first;
  const steps = [
    { done: status.hasPasscode, label: 'Passcode set' },
    { done: Boolean(recoveryAck), label: 'Recovery code saved', action: 'Create one', run: () => $('newRecovery').click() },
    { done: status.incognitoAllowed, label: 'Allow Latch in private windows', optional: true, action: 'Open settings', run: () => send({ type: 'openIncognitoSettings' }) },
  ];
  if (touchAvailable) steps.push({ done: status.touchId, label: 'Unlock with Touch ID', optional: true, action: 'Set up', run: () => $('touchSetup').click() });
  const remaining = steps.some((step) => !step.done);
  card.hidden = !(first || (remaining && !setupHidden));
  const list = $('steps');
  list.textContent = '';
  for (const step of steps) {
    const li = document.createElement('li');
    if (step.done) li.className = 'done';
    li.innerHTML = '<span class="mark"><svg class="i"><use href="icons.svg#check"/></svg></span><span class="grow"></span>';
    li.querySelector('.grow').textContent = step.label + (step.optional && !step.done ? ' (optional)' : '');
    if (!step.done && step.action) {
      const b = document.createElement('button');
      b.className = 'btn quiet'; b.type = 'button'; b.textContent = step.action; b.onclick = step.run;
      li.append(b);
    }
    list.append(li);
  }
}
$('setupHide').addEventListener('click', async () => { await chrome.storage.local.set({ setupHidden: true }); $('setupCard').hidden = true; });

// ---------- autosave ----------
async function saveSettings(passcode = '') {
  const result = await send({ type: 'saveSettings', settings: readForm(), passcode });
  if (result.ok) {
    saved = result.settings;
    writeForm(saved);
    renderOverview();
    toast('Saved.');
    return result;
  }
  if (result.needPasscode && result.error === 'need-passcode') {
    // Loosening a setting: ask for the passcode right where the person is working.
    askPasscode('Enter your passcode to apply this change', (pass) => saveSettings(pass), () => writeForm(saved));
    return result;
  }
  if (!result.needPasscode) toast(explain(result), 'error');
  return result;
}

for (const k of BOOLEANS) $(k).addEventListener('change', () => saveSettings());
for (const radio of document.querySelectorAll('input[name="scope"]')) radio.addEventListener('change', () => saveSettings());
for (const k of NUMBERS) {
  // Save when the person is done typing, not on every keystroke, and never treat an empty box as zero.
  $(k).addEventListener('input', syncChips);
  $(k).addEventListener('change', () => {
    if ($(k).value.trim() === '') { writeForm(saved); return; }
    saveSettings();
  });
}
for (const group of document.querySelectorAll('.chips')) {
  group.addEventListener('click', (event) => {
    const value = event.target.closest('button')?.dataset.v;
    if (value === undefined) return;
    $(group.dataset.for).value = value;
    syncChips();
    saveSettings();
  });
}

// ---------- hero actions ----------
$('lockNow').addEventListener('click', async () => {
  const result = await send({ type: 'lock' });
  if (!result.ok) {
    toast(result.error === 'incognito-not-allowed' ? 'Allow Latch in private windows first.' : 'Could not lock.', 'error');
    return;
  }
  mechanism.set(true, true);
  if (result.noPrivateWindows) toast('Locked. No private windows are open right now; new ones will be covered.');
});
$('allowPrivate').addEventListener('click', () => send({ type: 'openIncognitoSettings' }));
$('pauseOpen').addEventListener('click', () => { $('pauseChoice').hidden = !$('pauseChoice').hidden; });
for (const b of document.querySelectorAll('#pauseChoice .seg button')) {
  b.addEventListener('click', () => {
    pauseMinutes = Number(b.dataset.min);
    for (const o of document.querySelectorAll('#pauseChoice .seg button')) o.setAttribute('aria-pressed', String(o === b));
  });
}
$('pauseGo').addEventListener('click', () => {
  askPasscode('Enter your passcode to pause protection', async (pass) => {
    const result = await send({ type: 'pause', minutes: pauseMinutes, passcode: pass });
    if (result.ok) { await load(); toast('Protection paused.'); }
    return result;
  });
});
$('resumeNow').addEventListener('click', async () => { await send({ type: 'resume' }); await load(); toast('Protection resumed.'); });
$('turnOff').addEventListener('click', async () => {
  if (!saved.enabled) {
    const result = await send({ type: 'saveSettings', settings: { ...saved, enabled: true }, passcode: '' });
    if (result.ok) { await load(); toast('Latch is on.'); }
    return;
  }
  askPasscode('Enter your passcode to turn Latch off', async (pass) => {
    const result = await send({ type: 'saveSettings', settings: { ...saved, enabled: false }, passcode: pass });
    if (result.ok) { await load(); toast('Latch is off.'); }
    return result;
  });
});

// ---------- passcode ----------
function strength(pass) {
  if (pass.length < 4) return { level: 0, text: 'At least 4 characters.' };
  if (pass.length < 8) return { level: 1, text: 'Quick to type, but easy to guess. Longer is safer.' };
  if (pass.length < 12 && !/\s/.test(pass)) return { level: 2, text: 'Decent. A phrase of several words is stronger.' };
  return { level: 3, text: 'Strong.' };
}

function validatePasscodeForm() {
  const a = $('newPasscode').value, b = $('repeatPasscode').value;
  const s = strength(a);
  document.querySelector('.meter').dataset.level = a ? s.level : 0;
  $('strength').textContent = a ? s.text : 'At least 4 characters.';
  const mismatch = Boolean(b) && a !== b;
  $('repeatPasscode').setAttribute('aria-invalid', String(mismatch));
  const msg = $('passcodeMsg');
  if (mismatch) { msg.textContent = 'The two passcodes differ.'; msg.className = 'error'; }
  else if (msg.className === 'error') { msg.textContent = ''; msg.className = ''; }
  $('savePasscode').disabled = !(a.length >= 4 && a === b);
}
$('newPasscode').addEventListener('input', validatePasscodeForm);
$('repeatPasscode').addEventListener('input', validatePasscodeForm);

function placePasscodeForm() {
  const form = $('passcodeForm');
  const target = status.hasPasscode ? $('securityFormSlot') : $('setupFormSlot');
  if (form.parentElement !== target) target.append(form);
  form.classList.toggle('flat', !status.hasPasscode);
  form.hidden = status.hasPasscode && $('changePasscode').getAttribute('aria-expanded') !== 'true';
  $('currentRow').hidden = !status.hasPasscode;
  $('savePasscode').textContent = status.hasPasscode ? 'Change passcode' : 'Set passcode';
  $('changePasscode').textContent = status.hasPasscode ? 'Change…' : 'Set…';
}
$('changePasscode').addEventListener('click', () => {
  const open = $('passcodeForm').hidden;
  $('changePasscode').setAttribute('aria-expanded', String(open));
  $('passcodeForm').hidden = !open;
  if (open) $(status.hasPasscode ? 'currentPasscode' : 'newPasscode').focus();
});

$('passcodeForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const msg = $('passcodeMsg');
  const result = await send({ type: 'setPasscode', passcode: $('newPasscode').value, current: $('currentPasscode').value });
  if (!result.ok) { msg.textContent = explain(result); msg.className = 'error'; return; }
  for (const id of ['newPasscode', 'repeatPasscode', 'currentPasscode']) $(id).value = '';
  validatePasscodeForm();
  msg.textContent = '';
  $('changePasscode').setAttribute('aria-expanded', 'false');
  await load();
  if (result.recoveryCode) showRecovery(result.recoveryCode);
  else toast('Passcode changed.');
});

// show / hide on every passcode field
for (const button of document.querySelectorAll('.reveal')) {
  button.addEventListener('click', () => {
    const input = button.parentElement.querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.setAttribute('aria-label', button.getAttribute('aria-label').replace(show ? 'Show' : 'Hide', show ? 'Hide' : 'Show'));
    button.querySelector('use').setAttribute('href', show ? 'icons.svg#eye-off' : 'icons.svg#eye');
  });
}

// ---------- recovery code ----------
function showRecovery(code) {
  $('recoveryValue').textContent = code;
  $('recoverySaved').checked = false;
  $('recoveryDone').disabled = true;
  $('copyRecovery').querySelector('span').textContent = 'Copy';
  $('recoverySheet').hidden = false;
  $('content').hidden = true;
  $('recoverySaved').focus();
  window.scrollTo({ top: 0 });
}
$('recoverySaved').addEventListener('change', () => { $('recoveryDone').disabled = !$('recoverySaved').checked; });
$('copyRecovery').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('recoveryValue').textContent); $('copyRecovery').querySelector('span').textContent = 'Copied'; }
  catch { toast('Could not copy. Select the code and copy it by hand.', 'error'); }
});
$('downloadRecovery').addEventListener('click', () => {
  const blob = new Blob([`Latch recovery code\n\n${$('recoveryValue').textContent}\n\nKeep this somewhere safe. Anyone with it can reset your Latch passcode.\n`], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'latch-recovery-code.txt';
  a.click();
  URL.revokeObjectURL(a.href);
});
$('recoveryDone').addEventListener('click', async () => {
  await chrome.storage.local.set({ recoveryAck: true });
  $('recoverySheet').hidden = true;
  $('content').hidden = false;
  $('recoveryValue').textContent = '';
  await load();
  toast('You are protected. Press Lock now to try it.');
});
$('newRecovery').addEventListener('click', () => {
  askPasscode('Enter your passcode to create a new recovery code', async (pass) => {
    const result = await send({ type: 'regenerateRecovery', passcode: pass });
    if (result.ok) { await chrome.storage.local.remove('recoveryAck'); showRecovery(result.recoveryCode); }
    return result;
  });
});

// ---------- Touch ID ----------
$('touchSetup').addEventListener('click', () => {
  askPasscode('Enter your passcode to set up Touch ID', async (pass) => {
    const begin = await send({ type: 'touchIdBegin', passcode: pass });
    if (!begin.ok) return begin;
    let credential;
    try {
      credential = await navigator.credentials.create({
        publicKey: {
          challenge: b64u.decode(begin.challenge),
          rp: { name: 'Latch' },
          user: { id: b64u.decode(begin.userId), name: 'latch', displayName: 'Latch' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
          attestation: 'none',
          timeout: 60000,
        },
      });
    } catch (err) {
      return { ok: false, error: err?.name === 'NotAllowedError' ? 'cancelled' : 'unsupported' };
    }
    const r = credential.response;
    const result = await send({
      type: 'touchIdFinish',
      credentialId: b64u.encode(credential.rawId),
      publicKey: b64u.encode(r.getPublicKey()),
      clientDataJSON: b64u.encode(r.clientDataJSON),
      algorithm: r.getPublicKeyAlgorithm(),
    });
    if (result.ok) { await load(); toast('Touch ID is set up.'); }
    return result;
  });
});
$('touchRemove').addEventListener('click', async () => { await send({ type: 'touchIdRemove' }); await load(); toast('Touch ID removed.'); });

// ---------- private windows ----------
$('incognitoOpen').addEventListener('click', () => send({ type: 'openIncognitoSettings' }));
function renderIncognito() {
  const allowed = status.incognitoAllowed;
  $('incognitoTitle').textContent = allowed ? 'Latch works in private windows' : 'Latch cannot see private windows yet';
  $('incognitoHelp').textContent = allowed
    ? 'Private windows are covered and locked like any other.'
    : 'Open the extension settings and turn on “Allow in private” (Brave) or “Allow in Incognito” (Chrome).';
  $('incognitoOpen').hidden = allowed;
}

// ---------- activity ----------
const EVENT_TEXT = {
  lock: (d) => ['lock', 'Locked', d],
  unlock: (d) => ['unlock', 'Unlocked', d ? `with ${d}` : ''],
  failed: (d) => ['info', `Wrong ${d || 'passcode'} attempt`, ''],
  recovery: () => ['key', 'Passcode reset with the recovery code', ''],
  pause: (d) => ['pause', 'Protection paused', d],
  resume: () => ['check', 'Protection resumed', ''],
  setting: (d) => ['sliders', d ? d[0].toUpperCase() + d.slice(1) : 'Setting changed', ''],
  touchid: (d) => ['fingerprint', `Touch ID ${d}`, ''],
};
const relative = new Intl.RelativeTimeFormat([], { numeric: 'auto' });
function ago(t) {
  const seconds = Math.round((t - Date.now()) / 1000);
  const steps = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day']];
  let value = seconds, unit = 'second';
  for (const [size, name] of steps) { unit = name; if (Math.abs(value) < size) break; value = Math.round(value / size); }
  return Math.abs(seconds) < 45 ? 'just now' : relative.format(value, unit);
}

async function renderActivity() {
  const { events } = await send({ type: 'getActivity' });
  const list = $('activityList');
  list.textContent = '';
  $('clearActivity').hidden = !events.length;
  if (!events.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Nothing yet. Locks, unlocks and wrong guesses will appear here.';
    list.append(empty);
    return;
  }
  for (const e of events.slice(0, 30)) {
    const [icon, title, detail] = (EVENT_TEXT[e.type] || (() => ['info', e.type, e.detail]))(e.detail);
    const row = document.createElement('div');
    row.className = 'event';
    row.innerHTML = `<span class="rowIcon ${e.type === 'failed' ? 'warn' : ''}"><svg class="i"><use href="icons.svg#${icon}"/></svg></span><span class="grow"><span class="title"></span><span class="muted small block"></span></span><time class="when"></time>`;
    row.querySelector('.title').textContent = title;
    row.querySelector('.small').textContent = detail || '';
    row.querySelector('.small').hidden = !detail;
    const time = row.querySelector('time');
    time.textContent = ago(e.t);
    time.title = new Date(e.t).toLocaleString();
    list.append(row);
  }
}
$('clearActivity').addEventListener('click', () => {
  askPasscode('Enter your passcode to clear the activity', async (pass) => {
    const result = await send({ type: 'clearActivity', passcode: pass });
    if (result.ok) { await renderActivity(); toast('Activity cleared.'); }
    return result;
  });
});

// ---------- help ----------
$('shortcutsOpen').addEventListener('click', async () => {
  try { await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); }
  catch { toast('Open chrome://extensions/shortcuts in a new tab.', 'error'); }
});

// ---------- sidebar highlights the section in view ----------
const links = [...document.querySelectorAll('[data-nav]')];
const markCurrent = (name) => { for (const a of links) a.setAttribute('aria-current', String(a.dataset.nav === name)); };
window.addEventListener('scroll', () => { if (window.scrollY < 40) markCurrent('overview'); }, { passive: true });
markCurrent('overview');
const observer = new IntersectionObserver((entries) => {
  const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
  if (visible && window.scrollY >= 40) markCurrent(visible.target.id);
}, { rootMargin: '-10% 0px -70% 0px' });
for (const a of links) { const section = document.getElementById(a.dataset.nav); if (section) observer.observe(section); }

// ---------- load ----------
async function load() {
  const [{ settings }, st] = await Promise.all([send({ type: 'getSettings' }), send({ type: 'getStatus' })]);
  saved = settings;
  status = st;
  document.body.toggleAttribute('data-setup', !st.hasPasscode);
  if (!st.hasPasscode) $('settingsBody').setAttribute('inert', ''); else $('settingsBody').removeAttribute('inert');
  writeForm(settings);
  placePasscodeForm();
  renderOverview();
  renderIncognito();
  $('recoveryHelp').textContent = st.hasRecovery ? 'Set. Creating a new code replaces the old one.' : 'Lets you set a new passcode if you forget it.';
  $('newRecovery').textContent = st.hasRecovery ? 'Create a new code…' : 'Create a code…';
  $('touchHelp').textContent = !touchAvailable ? 'This browser cannot use Touch ID or a device passkey here. Your passcode works everywhere.'
    : st.touchId ? 'On. You can unlock with Touch ID or your passcode.' : 'Unlock with Touch ID or your device passkey. Your passcode always works too.';
  $('touchSetup').hidden = !touchAvailable || st.touchId;
  $('touchRemove').hidden = !st.touchId;
  await Promise.all([renderSetup(), renderActivity()]);
}

(async () => {
  mechanism = mountMechanism($('heroArt'), false);
  try { touchAvailable = Boolean(window.PublicKeyCredential) && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { touchAvailable = false; }
  await load();
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
})();

// Coming back from the extension settings page: re-check whether private windows are allowed.
window.addEventListener('focus', () => { if (status) load(); });
