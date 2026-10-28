// The connection to the Latch helper, a small macOS program the browser starts through native messaging.
// While locked, the helper keeps an opaque lock window exactly over each of this profile's browser windows. This file only
// opens and closes the connection and passes messages; it holds no passcode or lock logic.
const HOST = 'com.latch.helper';

let port = null;
let ready = false;          // the helper said hello
let biometric = false;      // and said whether this Mac has Touch ID to use
let announced = false;      // the helper has been told to lock (a freshly started helper has not)
let waiting = null;
let problem = '';           // why the last connection failed: 'missing' (not installed), 'forbidden' (installed for another folder) or 'other'
let failedAt = 0;           // when a connection last failed, so a missing helper is not retried on every event
let on = { message: () => {}, gone: () => {} };

export const helperUp = () => Boolean(port && ready);
export const helperAnnounced = () => announced;
export const helperProblem = () => problem;
export const helperBiometric = () => helperUp() && biometric;

export function sendHelper(message) {
  if (!helperUp()) return false;
  if (message.cmd === 'lock') announced = true;
  if (message.cmd === 'unlock') announced = false;      // the next lock must start the helper afresh
  try { port.postMessage(message); return true; } catch { return false; }
}

// Resolves true once the helper is running and has said hello, false if it is not installed or does not answer.
export function connectHelper(handlers, { force = false } = {}) {
  on = { ...on, ...handlers };
  if (helperUp()) return Promise.resolve(true);
  if (waiting) return waiting;
  if (!force && Date.now() - failedAt < 30000) return Promise.resolve(false);
  waiting = new Promise((resolve) => {
    let mine;
    try { mine = chrome.runtime.connectNative(HOST); } catch { failedAt = Date.now(); waiting = null; return resolve(false); }
    port = mine; ready = false; announced = false;
    const finish = (ok) => {
      clearTimeout(timer); waiting = null;
      if (!ok) { failedAt = Date.now(); try { mine.disconnect(); } catch { /* already gone */ } if (port === mine) { port = null; ready = false; } }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 2500);
    mine.onMessage.addListener((message) => {
      if (message?.event === 'ready') { ready = true; biometric = message.biometric === true; failedAt = 0; problem = ''; finish(true); return; }
      on.message(message);
    });
    mine.onDisconnect.addListener(() => {
      const reason = chrome.runtime.lastError?.message || '';   // read it so the browser does not log it
      if (!ready) problem = /forbidden/i.test(reason) ? 'forbidden' : /not found/i.test(reason) ? 'missing' : 'other';
      const wasUp = port === mine && ready;
      if (port === mine) { port = null; ready = false; announced = false; }
      if (waiting) finish(false);
      if (wasUp) on.gone();
    });
  });
  return waiting;
}

export function closeHelper() {
  if (!port) return;
  try { port.disconnect(); } catch { /* already gone */ }
  port = null; ready = false; announced = false;
}
