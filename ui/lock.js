const form = document.getElementById('form');
const input = document.getElementById('passcode');
const button = document.getElementById('unlock');
const errorEl = document.getElementById('error');
let countdown;

function showWait(ms) {
  clearInterval(countdown);
  const until = Date.now() + ms;
  const tick = () => {
    const left = Math.ceil((until - Date.now()) / 1000);
    if (left <= 0) { clearInterval(countdown); errorEl.textContent = ''; button.disabled = false; input.focus(); return; }
    errorEl.textContent = `Too many attempts. Try again in ${left}s.`;
    button.disabled = true;
  };
  tick();
  countdown = setInterval(tick, 500);
}

async function init() {
  const status = await chrome.runtime.sendMessage({ type: 'getStatus' });
  if (status.reason) document.getElementById('reason').textContent = status.reason;
  if (status.retryAfterMs) showWait(status.retryAfterMs);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (button.disabled) return;
  button.disabled = true;
  const result = await chrome.runtime.sendMessage({ type: 'unlock', passcode: input.value });
  input.value = '';
  if (result.ok) return;   // this window closes itself
  button.disabled = false;
  if (result.retryAfterMs) showWait(result.retryAfterMs);
  else errorEl.textContent = result.error === 'wrong' ? 'Wrong passcode.' : result.error === 'need-passcode' ? 'Type your passcode.' : 'Could not unlock: ' + result.error;
  form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
  input.focus();
});

init();
