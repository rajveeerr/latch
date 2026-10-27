const $ = (id) => document.getElementById(id);
const send = (message) => chrome.runtime.sendMessage(message);
let paused = false;

async function render() {
  const status = await send({ type: 'getStatus' });
  paused = Boolean(status.paused);
  $('setup').hidden = status.hasPasscode;
  $('main').hidden = !status.hasPasscode;
  $('resume').hidden = !paused;
  $('passcode').hidden = false;
  if (!status.enabled) $('status').textContent = 'Turned off in settings';
  else if (paused) $('status').textContent = 'Paused';
  else $('status').textContent = 'Protecting this profile';
  if (status.error) $('error').textContent = status.error;
}

$('openSetup').onclick = () => { chrome.runtime.openOptionsPage(); window.close(); };
$('settings').onclick = () => { chrome.runtime.openOptionsPage(); window.close(); };
$('lock').onclick = async () => { await send({ type: 'lock' }); window.close(); };
$('resume').onclick = async () => { await send({ type: 'resume' }); render(); };
$('pause').onclick = async () => {
  const result = await send({ type: 'pause', minutes: Number($('pauseFor').value), passcode: $('passcode').value });
  $('passcode').value = '';
  if (result.ok) { $('error').textContent = ''; return render(); }
  $('error').textContent = result.error === 'wrong' ? 'Wrong passcode.'
    : result.error === 'need-passcode' ? 'Enter your passcode to pause.'
    : result.error === 'locked-out' ? `Too many attempts. Wait ${Math.ceil(result.retryAfterMs / 1000)}s.`
    : 'Could not pause: ' + result.error;
};

render();
