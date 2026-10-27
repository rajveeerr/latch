const $ = (id) => document.getElementById(id);
const send = (message) => chrome.runtime.sendMessage(message);
const BOOLEANS = ['enabled', 'skipWhileAudio', 'lockOnStartup', 'lockOnSystemLock', 'minimizeWindows', 'coverPages', 'pauseMedia', 'muteTabs'];
const NUMBERS = ['autoLockMinutes', 'blurLockMinutes'];

function say(el, text, kind) {
  el.textContent = text;
  el.className = kind || '';
}

function explain(result) {
  if (result.error === 'wrong') return 'Wrong passcode.';
  if (result.error === 'need-passcode') return 'Enter your current passcode.';
  if (result.error === 'locked-out') return `Too many attempts. Wait ${Math.ceil(result.retryAfterMs / 1000)}s.`;
  if (result.error === 'too-short') return 'Use at least 4 characters.';
  if (result.error === 'too-long') return 'Use at most 128 characters.';
  return 'Failed: ' + result.error;
}

async function load() {
  const [{ settings }, status] = await Promise.all([send({ type: 'getSettings' }), send({ type: 'getStatus' })]);
  for (const k of BOOLEANS) $(k).checked = settings[k];
  for (const k of NUMBERS) $(k).value = settings[k];
  $('currentRow').hidden = !status.hasPasscode;
  $('authRow').hidden = !status.hasPasscode;
  $('savePasscode').textContent = status.hasPasscode ? 'Change passcode' : 'Set passcode';
}

$('savePasscode').onclick = async () => {
  const msg = $('passcodeMsg');
  if ($('newPasscode').value !== $('repeatPasscode').value) return say(msg, 'The two passcodes differ.', 'error');
  const result = await send({ type: 'setPasscode', passcode: $('newPasscode').value, current: $('currentPasscode').value });
  if (!result.ok) return say(msg, explain(result), 'error');
  for (const id of ['newPasscode', 'repeatPasscode', 'currentPasscode']) $(id).value = '';
  say(msg, 'Passcode saved.', 'ok');
  load();
};

$('save').onclick = async () => {
  const settings = {};
  for (const k of BOOLEANS) settings[k] = $(k).checked;
  for (const k of NUMBERS) settings[k] = Number($(k).value || 0);
  const result = await send({ type: 'saveSettings', settings, passcode: $('authPasscode').value });
  $('authPasscode').value = '';
  if (result.ok) { say($('saveMsg'), 'Saved.', 'ok'); return load(); }
  if (result.needPasscode) $('authRow').hidden = false;
  say($('saveMsg'), result.error === 'need-passcode' ? 'Enter your passcode to loosen settings.' : explain(result), 'error');
};

for (const group of document.querySelectorAll('.chips')) {
  group.addEventListener('click', (event) => {
    const value = event.target.dataset?.v;
    if (value !== undefined) $(group.dataset.for).value = value;
  });
}

load();
