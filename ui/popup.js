import { mountKerby } from './kerby.js';

const $ = (id) => document.getElementById(id);
const kerby = mountKerby($('mascot'), { state: 'guard' });
const send = (message) => chrome.runtime.sendMessage(message);
let minutes = 15;
let lastStatus = null;

if (!/Mac/.test(navigator.platform)) $('shortcut').textContent = 'Ctrl+Shift+L';

function describe(settings) {
  const when = [];
  if (settings.autoLockMinutes > 0) when.push(`${settings.autoLockMinutes} min of inactivity`);
  if (settings.blurLockMinutes > 0) when.push(`${settings.blurLockMinutes} min in the background`);
  const scope = settings.scope === 'private' ? 'Private windows' : 'Everything';
  return when.length ? `${scope} · locks after ${when.join(' or ')}` : `${scope} · locks when you press Lock now`;
}

async function render() {
  const [status, { settings }] = await Promise.all([send({ type: 'getStatus' }), send({ type: 'getSettings' })]);
  lastStatus = status;
  const privateLocked = status.locked && status.scope === 'private';
  const privateBlocked = status.scope === 'private' && !status.incognitoAllowed;
  $('setup').hidden = status.hasPasscode;
  $('main').hidden = !status.hasPasscode;
  $('resumeBar').hidden = !status.paused;
  $('lock').hidden = privateLocked;
  $('lock').disabled = privateBlocked;
  $('unlockPrivate').hidden = !privateLocked;
  $('error').textContent = '';
  $('info').textContent = '';

  const dot = $('dot');
  dot.className = 'dot';
  kerby.set(!status.hasPasscode ? 'guard' : (!status.enabled || status.paused) ? 'sleep' : 'guard');
  $('notice').hidden = !(status.failedSinceUnlock > 0);
  if (status.failedSinceUnlock > 0) {
    $('noticeText').textContent = status.failedSinceUnlock === 1
      ? '1 wrong passcode attempt since you last unlocked. Review'
      : `${status.failedSinceUnlock} wrong passcode attempts since you last unlocked. Review`;
  }

  if (!status.hasPasscode) { $('status').textContent = 'Not set up yet'; dot.classList.add('warn'); $('detail').textContent = ''; return; }
  if (!status.enabled) { $('status').textContent = 'Turned off'; $('detail').textContent = 'Turn it back on in Settings.'; return; }
  if (status.paused) {
    const forever = status.paused - Date.now() > 300 * 24 * 3600000;
    $('status').textContent = 'Paused';
    dot.classList.add('warn');
    $('pausedText').textContent = forever ? 'Paused until you resume' : 'Paused until ' + new Date(status.paused).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    $('detail').textContent = '';
    return;
  }
  if (privateBlocked) { $('status').textContent = 'Private windows can’t be locked yet'; dot.classList.add('warn'); $('detail').textContent = 'Allow Latch in private windows, in Settings.'; return; }
  if (privateLocked) { $('status').textContent = 'Private windows locked'; dot.classList.add('ok'); $('detail').textContent = 'Your other windows are not affected.'; return; }
  $('status').textContent = status.scope === 'private' ? 'Protecting private windows' : 'Protecting this profile';
  dot.classList.add('ok');
  $('detail').textContent = describe(settings);
}

const openSettings = (hash = '') => { chrome.tabs.create({ url: chrome.runtime.getURL('ui/options.html' + hash) }); window.close(); };
$('openSetup').onclick = () => openSettings();
$('settings').onclick = () => openSettings();
$('notice').onclick = () => openSettings('#activity');
$('lock').onclick = async () => {
  const result = await send({ type: 'lock' });
  if (!result.ok) { $('error').textContent = result.error === 'incognito-not-allowed' ? 'Allow Latch in private windows first.' : 'Could not lock. Please try again.'; return; }
  if (result.noPrivateWindows) { $('info').textContent = 'Locked. No private windows are open right now; new ones will be covered.'; render(); return; }
  window.close();
};
$('unlockPrivate').onclick = async () => { await send({ type: 'openUnlockWindow' }); window.close(); };
$('resume').onclick = async () => { await send({ type: 'resume' }); render(); };

function closePause() {
  $('pausePanel').hidden = true;
  $('pauseToggle').setAttribute('aria-expanded', 'false');
}
$('pauseToggle').onclick = () => {
  const open = $('pausePanel').hidden;
  $('pausePanel').hidden = !open;
  $('pauseToggle').setAttribute('aria-expanded', String(open));
  if (open) $('passcode').focus();
};
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('pausePanel').hidden) { event.preventDefault(); closePause(); $('pauseToggle').focus(); } });

for (const button of document.querySelectorAll('.seg button')) {
  button.onclick = () => {
    minutes = Number(button.dataset.min);
    for (const b of document.querySelectorAll('.seg button')) b.setAttribute('aria-pressed', String(b === button));
    $('passcode').focus();
  };
}

$('pausePanel').addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await send({ type: 'pause', minutes, passcode: $('passcode').value });
  $('passcode').value = '';
  if (result.ok) { closePause(); return render(); }
  $('error').textContent = result.error === 'wrong' ? 'Wrong passcode.'
    : result.error === 'need-passcode' ? 'Enter your passcode to pause.'
    : result.error === 'locked-out' ? `Too many attempts. Wait ${Math.ceil(result.retryAfterMs / 1000)}s.`
    : 'Could not pause. Please try again.';
  $('passcode').focus();
});

render();
