// Latch background worker.
//
// Safety rules (checked by test/unit/safety.test.js):
//   * never close a tab or a user window; the only window this file ever closes is
//     its own lock window, and only after checking it really is that window
//   * never navigate, discard, reload or edit tabs, tab groups or bookmarks
//   * everything is reversible: windows are minimized and restored, tabs muted and unmuted
//   * if enforcing the lock fails repeatedly, unlock rather than leave the browser stuck

import { DEFAULTS, normalizeSettings, isWeakening } from './lib/settings.js';
import { hasPasscode, setPasscode, verifyPasscode } from './lib/auth.js';

const LOCK_PAGE = chrome.runtime.getURL('ui/lock.html');
const EXTENSION_ORIGIN = chrome.runtime.getURL('');

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
    const state = await getState();
    if (!state.locked) {
      await patchState({ ...EMPTY_SESSION, locked: true, reason, lockedAt: Date.now(), error: '' });
    }
    await enforceLocked();
    return { ok: true };
  });
}

// Idempotent: runs on lock and again whenever something happens that could expose a window.
async function enforceLocked() {
  const state = await getState();
  if (!state.locked) return;
  const settings = await getSettings();
  try {
    if (settings.minimizeWindows) await minimizeWindows();
    if (settings.muteTabs) await muteAudibleTabs();
    await ensureLockWindow();
    if (state.failures) await patchState({ failures: 0 });
  } catch (err) {
    const failures = state.failures + 1;
    await patchState({ failures, error: String(err?.message || err) });
    if (failures >= 3) await unlockNow('Latch could not enforce the lock and unlocked itself: ' + (err?.message || err));
  }
}

async function minimizeWindows() {
  const state = await getState();
  const windowStates = { ...state.windowStates };
  const windows = await chrome.windows.getAll({ windowTypes: ['normal', 'app'] });
  for (const win of windows) {
    if (win.id === state.lockWindowId) continue;
    if (!(win.id in windowStates)) windowStates[win.id] = win.state;
    if (win.state === 'minimized') continue;
    try {
      if (win.state === 'fullscreen') await chrome.windows.update(win.id, { state: 'normal' });
      await chrome.windows.update(win.id, { state: 'minimized' });
    } catch { /* window went away; nothing to do */ }
  }
  await patchState({ windowStates });
}

async function muteAudibleTabs() {
  const state = await getState();
  const muted = new Set(state.mutedTabs);
  for (const tab of await chrome.tabs.query({ audible: true })) {
    if (tab.mutedInfo?.muted) continue;
    try { await chrome.tabs.update(tab.id, { muted: true }); muted.add(tab.id); } catch { /* tab went away */ }
  }
  await patchState({ mutedTabs: [...muted] });
}

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

// ---------- unlocking ----------

function unlockNow(error = '') {
  return serial(async () => {
    const state = await getState();
    await patchState({ locked: false, reason: '', error });   // pages uncover as soon as this lands
    for (const id of state.mutedTabs) {
      try { await chrome.tabs.update(id, { muted: false }); } catch { /* tab is gone */ }
    }
    let focusId = null;
    for (const [id, previous] of Object.entries(state.windowStates)) {
      try {
        await chrome.windows.update(Number(id), { state: previous });
        if (previous !== 'minimized') focusId = Number(id);
      } catch { /* window is gone */ }
    }
    await closeLockWindow(state.lockWindowId);
    if (focusId != null) { try { await chrome.windows.update(focusId, { focused: true }); } catch { /* gone */ } }
    await patchState({ lockWindowId: null, windowStates: {}, mutedTabs: [], failures: 0 });
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
  if (state.locked && windowId === state.lockWindowId) {
    await patchState({ lockWindowId: null });
    setTimeout(() => serial(enforceLocked), 250);   // closed it? It comes straight back
  }
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

// ---------- messages from our own pages ----------

async function status() {
  const [settings, state] = await Promise.all([getSettings(), getState()]);
  const auth = await store.get('auth');
  return {
    locked: state.locked,
    reason: state.reason,
    error: state.error,
    paused: state.pausedUntil > Date.now() ? state.pausedUntil : 0,
    enabled: settings.enabled,
    hasPasscode: await hasPasscode(store),
    retryAfterMs: Math.max(0, (auth?.lockoutUntil || 0) - Date.now()),
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

  async unlock({ passcode }) {
    const check = await checkPasscode(passcode);
    return check.ok ? unlockNow() : check;
  },

  async pause({ minutes, passcode }) {
    const check = await checkPasscode(passcode);
    if (!check.ok) return check;
    const until = minutes > 0 ? Date.now() + minutes * 60000 : Date.now() + 365 * 24 * 3600000;
    await patchState({ pausedUntil: until });
    return { ok: true };
  },

  async resume() {
    await patchState({ pausedUntil: 0 });
    return { ok: true };
  },

  async setPasscode({ passcode, current }) {
    return setPasscode(store, passcode, current);
  },

  async saveSettings({ settings, passcode }) {
    const previous = await getSettings();
    const next = normalizeSettings(settings);
    if ((await hasPasscode(store)) && isWeakening(previous, next)) {
      const check = await checkPasscode(passcode);
      if (!check.ok) return { ...check, needPasscode: true };
    }
    await store.set('settings', next);
    await configureIdle();
    return { ok: true, settings: next };
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only Latch's own pages may talk to us, never a web page or another extension.
  const fromOurPage = sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(EXTENSION_ORIGIN);
  const handler = handlers[message?.type];
  if (!fromOurPage || !handler) return false;
  handler(message).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});
