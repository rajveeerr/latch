// Latch background worker.
//
// Safety rules (checked by test/unit/safety.test.js):
//   * never close a tab or a user window; the only window this file ever closes is
//     its own lock window, and only after checking it really is that window
//   * never navigate, discard, reload or edit tabs, tab groups or bookmarks
//   * everything is reversible: windows are minimized and restored, tabs muted and unmuted
//   * if enforcing the lock fails repeatedly, unlock rather than leave the browser stuck

import { DEFAULTS, normalizeSettings, isWeakening, covers } from './lib/settings.js';
import {
  hasPasscode, setPasscode, verifyPasscode, resetWithRecovery, regenerateRecovery,
} from './lib/auth.js';
import { logEvent, getEvents, clearEvents, failuresSinceUnlock } from './lib/activity.js';
import { verifyAssertion, checkRegistration, newChallenge, b64u } from './lib/webauthn.js';

const LOCK_PAGE = chrome.runtime.getURL('ui/lock.html');
const EXTENSION_ORIGIN = chrome.runtime.getURL('');
const ORIGIN = EXTENSION_ORIGIN.replace(/\/$/, '');   // what WebAuthn reports as the origin
const RP_ID = ORIGIN;                                 // Chromium also uses the whole origin as the relying party id

const store = {
  get: async (key) => (await chrome.storage.local.get(key))[key],
  set: (key, value) => chrome.storage.local.set({ [key]: value }),
};

// What must survive a browser restart (and be visible to pages) lives in storage.local.
// Window and tab ids only mean something until the browser closes, so they live in
// storage.session, which the browser clears on its own.
const EMPTY_PERSISTENT = {
  locked: false,
  reason: '',
  lockedAt: 0,
  pausedUntil: 0,
  error: '',          // last problem, shown in settings
};
const EMPTY_SESSION = {
  lockWindowId: null,
  windowStates: {},   // window id -> state before we minimized it
  mutedTabs: [],      // tab ids we muted
  failures: 0,        // consecutive failed attempts to enforce the lock
  focusedBefore: null, // the window you were using when it locked, so unlocking can hand focus straight back
};

const getSettings = async () => normalizeSettings(await store.get('settings'));
const getState = async () => ({
  ...EMPTY_PERSISTENT,
  ...EMPTY_SESSION,
  ...(await store.get('state')),
  ...((await chrome.storage.session.get('session')).session),
});
async function patchState(patch) {
  const next = { ...(await getState()), ...patch };
  const persistent = {}, session = {};
  for (const key of Object.keys(EMPTY_PERSISTENT)) persistent[key] = next[key];
  for (const key of Object.keys(EMPTY_SESSION)) session[key] = next[key];
  await store.set('state', persistent);
  await chrome.storage.session.set({ session });
  return next;
}

// One lock operation at a time, so event bursts cannot interleave.
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

// ---------- locking ----------

async function lock(reason) {
  return serial(async () => {
    const settings = await getSettings();
    if (!settings.enabled) return { ok: false, error: 'disabled' };
    if (!(await hasPasscode(store))) {
      chrome.runtime.openOptionsPage();
      return { ok: false, error: 'no-passcode' };
    }
    // "Private windows only" can do nothing until Latch is allowed in private windows. Say so instead of pretending.
    let noPrivateWindows = false;
    if (settings.scope === 'private') {
      let allowed = false;
      try { allowed = await chrome.extension.isAllowedIncognitoAccess(); } catch { /* unknown */ }
      if (!allowed) return { ok: false, error: 'incognito-not-allowed' };
      noPrivateWindows = !(await chrome.windows.getAll({ windowTypes: ['normal'] })).some((win) => win.incognito);
    }
    const state = await getState();
    if (!state.locked) {
      let focusedBefore = null;
      try { focusedBefore = (await chrome.windows.getLastFocused()).id; } catch { /* none */ }
      await patchState({ ...EMPTY_SESSION, focusedBefore, locked: true, reason, lockedAt: Date.now(), error: '' });
      await logEvent(store, 'lock', reason);
    }
    await enforceLocked();
    return { ok: true, noPrivateWindows };
  });
}

// Idempotent: runs on lock and again whenever something happens that could expose a window.
async function enforceLocked() {
  const state = await getState();
  if (!state.locked) return;
  const settings = await getSettings();
  try {
    if (settings.minimizeWindows) await minimizeWindows(settings);
    if (settings.muteTabs) await muteAudibleTabs(settings);
    if (settings.scope === 'profile') await ensureLockWindow();
    if (state.failures) await patchState({ failures: 0 });
  } catch (err) {
    const failures = state.failures + 1;
    await patchState({ failures, error: String(err?.message || err) });
    if (failures >= 3) await unlockNow({ error: 'Latch could not enforce the lock and unlocked itself: ' + (err?.message || err), method: 'safety' });
  }
}

async function minimizeWindows(settings) {
  const state = await getState();
  const windowStates = { ...state.windowStates };
  const windows = await chrome.windows.getAll({ windowTypes: ['normal', 'app'] });
  for (const win of windows) {
    if (win.id === state.lockWindowId || !covers(settings, win)) continue;
    // A full-screen window lives in its own macOS Space. Leaving it and re-entering it is what stranded people on
    // the lock page, so full-screen windows are never touched: the page cover and the lock window handle them.
    if (win.state === 'fullscreen') continue;
    if (!(win.id in windowStates)) windowStates[win.id] = win.state;
    if (win.state === 'minimized') continue;
    try {
      await chrome.windows.update(win.id, { state: 'minimized' });
    } catch { /* window went away; nothing to do */ }
  }
  await patchState({ windowStates });
}

async function muteAudibleTabs(settings) {
  const state = await getState();
  const muted = new Set(state.mutedTabs);
  for (const tab of await chrome.tabs.query({ audible: true })) {
    if (tab.mutedInfo?.muted || !covers(settings, tab)) continue;
    try { await chrome.tabs.update(tab.id, { muted: true }); muted.add(tab.id); } catch { /* tab went away */ }
  }
  await patchState({ mutedTabs: [...muted] });
}

// Full-screen lock window for "everything" mode.
async function ensureLockWindow() {
  const state = await getState();
  if (state.lockWindowId != null) {
    try {
      const win = await chrome.windows.get(state.lockWindowId);
      await chrome.windows.update(win.id, { state: 'maximized', focused: true });
      return;
    } catch { /* it was closed; make a new one */ }
  }
  let win;
  try {
    win = await chrome.windows.create({ url: LOCK_PAGE, type: 'popup', focused: true, state: 'maximized' });
  } catch {
    win = await chrome.windows.create({ url: LOCK_PAGE, type: 'popup', focused: true, width: 900, height: 640 });
  }
  await patchState({ lockWindowId: win.id });
}

// Small unlock window for "private windows only" mode, opened on request.
function openUnlockWindow() {
  return serial(async () => {
    const state = await getState();
    if (!state.locked) return { ok: false, error: 'not-locked' };
    if (state.lockWindowId != null) {
      try { await chrome.windows.update(state.lockWindowId, { focused: true }); return { ok: true }; } catch { /* closed */ }
    }
    const win = await chrome.windows.create({ url: LOCK_PAGE, type: 'popup', focused: true, width: 520, height: 700 });
    await patchState({ lockWindowId: win.id });
    return { ok: true };
  });
}

// ---------- unlocking ----------

function unlockNow({ error = '', method = 'passcode' } = {}) {
  return serial(async () => {
    const state = await getState();
    await patchState({ locked: false, reason: '', error });   // pages uncover as soon as this lands
    if (state.locked) await logEvent(store, 'unlock', method);
    for (const id of state.mutedTabs) {
      try { await chrome.tabs.update(id, { muted: false }); } catch { /* tab is gone */ }
    }
    // Close our window first, then bring back only what we minimized, then give focus back to where you were.
    await closeLockWindow(state.lockWindowId);
    let focusId = null;
    for (const [id, previous] of Object.entries(state.windowStates)) {
      try {
        await chrome.windows.update(Number(id), { state: previous === 'minimized' ? 'minimized' : previous });
        if (previous !== 'minimized') focusId = Number(id);
      } catch { /* window is gone */ }
    }
    for (const candidate of [state.focusedBefore, focusId]) {
      if (candidate == null) continue;
      try { await chrome.windows.update(candidate, { focused: true }); break; } catch { /* try the next */ }
    }
    await patchState({ lockWindowId: null, windowStates: {}, mutedTabs: [], failures: 0, focusedBefore: null });
    return { ok: true };
  });
}

// The only place a window is ever closed. Refuses unless it is our own lock page, alone in its window.
async function closeLockWindow(id) {
  if (id == null) return;
  try {
    const win = await chrome.windows.get(id, { populate: true });
    const isOurs = win.type === 'popup' && win.tabs?.length === 1 && win.tabs[0].url?.startsWith(LOCK_PAGE);
    if (isOurs) await chrome.windows.remove(id);
  } catch { /* already closed */ }
}

// ---------- automatic triggers ----------

async function autoLock(reason, { respectPause = true } = {}) {
  const [settings, state] = await Promise.all([getSettings(), getState()]);
  if (!settings.enabled || state.locked) return;
  if (respectPause && state.pausedUntil > Date.now()) return;
  await lock(reason);
}

async function configureIdle() {
  const { autoLockMinutes } = await getSettings();
  chrome.idle.setDetectionInterval(Math.max(15, Math.round((autoLockMinutes || 1) * 60)));
}

chrome.idle.onStateChanged.addListener(async (idleState) => {
  const settings = await getSettings();
  if (idleState === 'locked' && settings.lockOnSystemLock) return autoLock('The screen was locked');
  if (idleState === 'idle' && settings.autoLockMinutes > 0) {
    if (settings.skipWhileAudio && (await chrome.tabs.query({ audible: true })).length) return;
    return autoLock(`${settings.autoLockMinutes} min of inactivity`);
  }
});

// Browser in the background for a while.
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  const settings = await getSettings();
  const state = await getState();
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    if (settings.blurLockMinutes > 0 && !state.locked) chrome.alarms.create('blur', { delayInMinutes: settings.blurLockMinutes });
    return;
  }
  chrome.alarms.clear('blur');
  if (state.locked && windowId !== state.lockWindowId) serial(enforceLocked);   // something else came to the front
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'blur') autoLock('The browser was in the background');
});

// Windows opened while locked (new window shortcut, session restore) are hidden at once.
chrome.windows.onCreated.addListener(async (win) => {
  if (win.type !== 'popup' && (await getState()).locked) serial(enforceLocked);
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const state = await getState();
  if (windowId !== state.lockWindowId) return;
  await patchState({ lockWindowId: null });
  // "Everything" mode: closing the lock window brings it straight back. Private-only mode just stays covered.
  if (state.locked && (await getSettings()).scope === 'profile') setTimeout(() => serial(enforceLocked), 250);
});

chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  if (change.audible && (await getState()).locked && (await getSettings()).muteTabs) serial(enforceLocked);
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'lock-now') lock('Locked with the keyboard shortcut');
});

// ---------- lifecycle ----------

async function start(browserJustStarted) {
  await configureIdle();
  if ((await getState()).locked) return serial(enforceLocked);
  if (browserJustStarted && (await getSettings()).lockOnStartup) return autoLock('The browser started', { respectPause: false });
}

chrome.runtime.onStartup.addListener(() => start(true));
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
  await start(false);
});
start(false);   // also runs whenever the worker wakes up

// ---------- Touch ID (WebAuthn) ----------

const CHALLENGE_TTL = 2 * 60 * 1000;

async function issueChallenge(purpose) {
  const challenge = newChallenge();
  await chrome.storage.session.set({ challenge: { value: challenge, purpose, expires: Date.now() + CHALLENGE_TTL } });
  return challenge;
}

// A challenge can be used once, for the purpose it was issued for.
async function takeChallenge(purpose) {
  const { challenge } = await chrome.storage.session.get('challenge');
  await chrome.storage.session.remove('challenge');
  return challenge && challenge.purpose === purpose && challenge.expires > Date.now() ? challenge.value : null;
}

// ---------- messages from our own pages ----------

async function status() {
  const [settings, state, authRecord, credential, events] = await Promise.all([
    getSettings(), getState(), store.get('auth'), store.get('credential'), getEvents(store),
  ]);
  let incognitoAllowed = false;
  try { incognitoAllowed = await chrome.extension.isAllowedIncognitoAccess(); } catch { /* unknown */ }
  return {
    locked: state.locked,
    reason: state.reason,
    error: state.error,
    paused: state.pausedUntil > Date.now() ? state.pausedUntil : 0,
    enabled: settings.enabled,
    scope: settings.scope,
    hasPasscode: await hasPasscode(store),
    hasRecovery: Boolean(await store.get('recovery')),
    touchId: Boolean(credential),
    incognitoAllowed,
    extensionId: chrome.runtime.id,
    failedSinceUnlock: failuresSinceUnlock(events),
    retryAfterMs: Math.max(0, (authRecord?.lockoutUntil || 0) - Date.now()),
  };
}

// An empty field is "not entered yet", not a wrong guess, so it must not count as a failed attempt.
async function checkPasscode(passcode) {
  if (!passcode) return { ok: false, error: 'need-passcode' };
  return verifyPasscode(store, passcode);
}

const handlers = {
  getStatus: () => status(),
  getSettings: async () => ({ settings: await getSettings(), defaults: DEFAULTS }),
  lock: () => lock('Locked manually'),
  openUnlockWindow: () => openUnlockWindow(),

  async unlock({ passcode }) {
    const check = await checkPasscode(passcode);
    if (check.ok) return unlockNow({ method: 'passcode' });
    if (check.error === 'wrong') await logEvent(store, 'failed', 'passcode');
    return check;
  },

  async pause({ minutes, passcode }) {
    const check = await checkPasscode(passcode);
    if (!check.ok) return check;
    const until = minutes > 0 ? Date.now() + minutes * 60000 : Date.now() + 365 * 24 * 3600000;
    await patchState({ pausedUntil: until });
    await logEvent(store, 'pause', minutes > 0 ? `${minutes} min` : 'until resumed');
    return { ok: true };
  },

  async resume() {
    await patchState({ pausedUntil: 0 });
    await logEvent(store, 'resume');
    return { ok: true };
  },

  async setPasscode({ passcode, current }) {
    const result = await setPasscode(store, passcode, current);
    if (result.ok) await logEvent(store, 'setting', result.recoveryCode ? 'passcode created' : 'passcode changed');
    return result;
  },

  async regenerateRecovery({ passcode }) {
    const result = await regenerateRecovery(store, passcode);
    if (result.ok) await logEvent(store, 'setting', 'new recovery code');
    return result;
  },

  // Forgot the passcode while locked: the recovery code sets a new one. The page then unlocks with it.
  async recoverReset({ code, newPasscode }) {
    const result = await resetWithRecovery(store, code, newPasscode);
    if (result.ok) await logEvent(store, 'recovery', 'passcode reset with the recovery code');
    else if (result.error === 'wrong') await logEvent(store, 'failed', 'recovery code');
    return result;
  },

  async saveSettings({ settings, passcode }) {
    const previous = await getSettings();
    const next = normalizeSettings(settings);
    const weakening = isWeakening(previous, next);
    if ((await hasPasscode(store)) && weakening) {
      const check = await checkPasscode(passcode);
      if (!check.ok) return { ...check, needPasscode: true };
    }
    await store.set('settings', next);
    await configureIdle();
    if (weakening) await logEvent(store, 'setting', next.enabled ? 'protection loosened' : 'Latch turned off');
    return { ok: true, settings: next };
  },

  // ----- Touch ID / device passkey -----
  async touchIdBegin({ passcode }) {
    const check = await checkPasscode(passcode);
    if (!check.ok) return check;
    return { ok: true, challenge: await issueChallenge('register'), userId: b64u.encode(crypto.getRandomValues(new Uint8Array(16))) };
  },

  async touchIdFinish({ credentialId, publicKey, clientDataJSON, algorithm }) {
    const expected = await takeChallenge('register');
    if (!expected) return { ok: false, error: 'expired' };
    const check = checkRegistration({ expectedChallenge: expected, expectedOrigin: ORIGIN, clientDataJSON, algorithm });
    if (!check.ok) return check;
    await store.set('credential', { id: credentialId, publicKey, created: Date.now() });
    await logEvent(store, 'touchid', 'set up');
    return { ok: true };
  },

  async touchIdRemove() {
    await chrome.storage.local.remove('credential');
    await logEvent(store, 'touchid', 'removed');
    return { ok: true };
  },

  async touchIdChallenge() {
    const credential = await store.get('credential');
    if (!credential) return { ok: false, error: 'not-set-up' };
    return { ok: true, challenge: await issueChallenge('unlock'), credentialId: credential.id };
  },

  async touchIdUnlock({ assertion }) {
    const [credential, expected] = [await store.get('credential'), await takeChallenge('unlock')];
    if (!credential || !expected) return { ok: false, error: 'expired' };
    const result = await verifyAssertion({ publicKey: credential.publicKey, expectedChallenge: expected, expectedOrigin: ORIGIN, expectedRpId: RP_ID, assertion });
    if (!result.ok) { await logEvent(store, 'failed', 'Touch ID'); return result; }
    return unlockNow({ method: 'Touch ID' });
  },

  // ----- activity and incognito -----
  getActivity: async () => ({ events: await getEvents(store) }),

  async clearActivity({ passcode }) {
    const check = await checkPasscode(passcode);       // wiping the evidence needs the passcode
    if (!check.ok) return check;
    await clearEvents(store);
    return { ok: true };
  },

  async openIncognitoSettings() {
    await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler || sender.id !== chrome.runtime.id) return false;
  const fromOurPage = typeof sender.url === 'string' && sender.url.startsWith(EXTENSION_ORIGIN);
  // A page cover may ask for the unlock window, and nothing else.
  const fromCover = Boolean(sender.tab) && message.type === 'openUnlockWindow';
  if (!fromOurPage && !fromCover) return false;
  handler(message).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});
