// Latch background worker.
//
// Safety rules (checked by test/unit/safety.test.js):
//   * never close a tab or a user window; the only window this file ever closes is
//     its own lock window, and only after checking it really is that window
//   * never navigate, discard, reload or edit tabs, tab groups or bookmarks
//   * everything is reversible: windows are minimized and restored, tabs muted and unmuted
//   * if enforcing the lock fails repeatedly, unlock rather than leave the browser stuck

import { DEFAULTS, normalizeSettings, isWeakening, covers, overlayStyle } from './lib/settings.js';
import {
  hasPasscode, setPasscode, verifyPasscode, resetWithRecovery, regenerateRecovery,
} from './lib/auth.js';
import { logEvent, getEvents, clearEvents, failuresSinceUnlock } from './lib/activity.js';
import { verifyAssertion, checkRegistration, newChallenge, b64u } from './lib/webauthn.js';

// Built from the id, not getURL: for a page that pages may frame (see the manifest) getURL gives a random per-session address,
// while the windows we open for it, and the check that closeLockWindow does, use the normal one.
const LOCK_PAGE = `chrome-extension://${chrome.runtime.id}/ui/lock.html`;
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
  keptOpen: [],       // windows strict hiding left open because they hold unsaved typing or sound (logged once each)
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

// Idempotent: the full pass runs on lock, and a fast pass runs whenever something could expose a window.
let fastPending = false;
let broughtForward = null;                       // the window the last event put in front, if it was not the lock window
let recentPasses = [];                           // start times of recent fast passes (circuit breaker below)
function enforceSoon(windowId = null) {
  if (windowId != null) broughtForward = windowId;
  if (fastPending) return;                      // a burst of events needs only one pass
  // Our own minimizing moves focus, which raises more events. If passes keep coming back to back, something is feeding
  // itself (a loop), so stop for a few seconds instead of spinning. The next real event after that is handled normally.
  const now = Date.now();
  recentPasses = recentPasses.filter((t) => now - t < 5000);
  if (recentPasses.length >= 6) return;
  recentPasses.push(now);
  fastPending = true;
  serial(async () => { fastPending = false; await enforceLocked({ fast: true }); });
}

async function enforceLocked({ fast = false } = {}) {
  const state = await getState();
  if (!state.locked) return;
  const settings = await getSettings();
  try {
    if (overlayStyle(settings)) {
      // The lock sits on the windows themselves: every page already carries the cover with the unlock screen in it. All that is
      // left is a window whose visible tab cannot hold a cover (new tab page, settings), which is minimized like before.
      if (!fast) { minimizedAt.clear(); await ensureCovers(settings); }
      await secureExposed(settings, { fresh: !fast });
      if (!fast && settings.muteTabs) await muteAudibleTabs(settings);
    } else if (fast) {
      // Something came forward while locked (the Dock, Mission Control, Cmd+Tab). Do only the instant things, in this order:
      // the lock window first, then put the window away. The covers are already on every page, so no per-tab work here.
      if (settings.scope === 'profile') await ensureLockWindow(settings);
      if (settings.minimizeWindows) await minimizeWindows(settings, { full: false });
    } else {
      // Order matters for speed and for leaks: the cover goes on every page first (instant), then the lock window rises
      // over the screen, and only then are windows taken out of the way (the slow, animated part).
      await ensureCovers(settings);
      if (settings.scope === 'profile') await ensureLockWindow(settings);
      if (settings.hideMode === 'close' && (await isMac()) && !(await isBrave())) await strictHide(settings);   // (only reached in the lock-window style)
      if (settings.minimizeWindows) await minimizeWindows(settings);
      if (settings.muteTabs) await muteAudibleTabs(settings);
    }
    if (state.failures) await patchState({ failures: 0 });
  } catch (err) {
    const failures = state.failures + 1;
    await patchState({ failures, error: String(err?.message || err) });
    if (failures >= 3) await unlockNow({ error: 'Latch could not enforce the lock and unlocked itself: ' + (err?.message || err), method: 'safety' });
  }
}

// Hide this profile's windows. The extension API only ever returns windows of the profile it is installed in, so
// other profiles' windows are never seen, let alone touched.
// Windows we minimized in this lock, and when. The browser may report "normal" for a window that really is minimized
// (Brave on macOS), so without this every pass would minimize every window again, and each minimize moves focus, which
// starts the next pass: an endless loop. A window is minimized again only when it was just brought forward, and not
// twice within 0.8 seconds.
const minimizedAt = new Map();
async function minimizeWindows(settings, { full = true, only = null } = {}) {
  if (full && !only) minimizedAt.clear();
  const forward = broughtForward; broughtForward = null;
  const state = await getState();
  const windowStates = { ...state.windowStates };
  const windows = await chrome.windows.getAll({ windowTypes: ['normal', 'app'] });
  for (const win of windows) {
    if (win.id === state.lockWindowId || !covers(settings, win)) continue;
    if (only && !only.includes(win.id)) continue;
    // What to put back on unlock. The browser's reported state cannot be trusted to say "minimized" (Brave on macOS reports
    // "normal" for a window that really is minimized), so every window we ask to minimize is always asked to come back.
    if (!(win.id in windowStates)) windowStates[win.id] = { state: win.state, left: win.left, top: win.top, width: win.width, height: win.height };
    if (win.state === 'minimized') continue;
    const last = minimizedAt.get(win.id);
    if (!full && last != null && !(win.id === forward && Date.now() - last > 800)) continue;   // already put away
    minimizedAt.set(win.id, Date.now());
    try {
      // A full-screen window is its own macOS Space and cannot be minimized directly: step out of full screen first.
      // Showing its tabs and page while "locked" would be a leak, so security wins over avoiding the animation.
      if (win.state === 'fullscreen') await chrome.windows.update(win.id, { state: 'normal' });
      await chrome.windows.update(win.id, { state: 'minimized' });
    } catch { /* the window went away; nothing to do */ }
  }
  await patchState({ windowStates });
}

// ---------- complete hiding (macOS) ----------
// The windows of this profile are closed while locked, so nothing shows in Stage Manager, Mission Control or the Dock,
// and rebuilt from a saved record on unlock: same windows, sizes, tab order, pinned tabs, groups (name, colour, collapsed),
// active tab and scroll position. This is how other browser lockers work, so it is fenced and made safer than they are:
//   * only when the lock window is already up (so the browser never ends up with no window at all)
//   * never a window with unsaved typing, a playing tab, or a page that cannot be reopened (brave:// pages, extension pages)
//   * the record is saved to persistent storage BEFORE anything is closed, so quitting the browser while locked loses nothing
//   * tabs are closed one by one, which is also what makes it work in Brave (it asks before closing a multi-tab window)
//   * every window is checked afterwards, and one that did not close is simply minimized instead
const isMac = async () => (await chrome.runtime.getPlatformInfo()).os === 'mac';
// Closing windows from an extension crashes Brave on macOS (a null-pointer fault in its window-close handler, reproduced
// by test/e2e/stress.mjs). The settings page records whether this is Brave, and complete hiding refuses to run there.
const isBrave = async () => (await store.get('browser'))?.brave === true;
const REOPENABLE = /^(https?|file|ftp):/;
const BLANK = /^(about:blank|chrome:\/\/newtab\/?|brave:\/\/newtab\/?|chrome-search:\/\/local-ntp\/.*|edge:\/\/newtab\/?)$/;

// True when a page holds typing that has not been saved anywhere: a changed field, or text in an editable region.
function pageHasUnsavedTyping() {
  const fields = document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=file]),textarea');
  for (const el of fields) if (el.value !== el.defaultValue) return true;
  for (const el of document.querySelectorAll('[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]')) if (el.textContent.trim().length) return true;
  return false;
}

async function windowIsRisky(win) {
  if (win.tabs.some((tab) => tab.audible)) return true;                       // playing media would be lost
  const unreopenable = win.tabs.some((tab) => { const url = tab.url || tab.pendingUrl || ''; return !REOPENABLE.test(url) && !BLANK.test(url); });
  if (unreopenable) return true;                                              // an internal or extension page cannot be recreated
  const checks = await Promise.allSettled(win.tabs.filter((tab) => !tab.discarded && REOPENABLE.test(tab.url || '')).map((tab) =>
    chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: pageHasUnsavedTyping })));
  return checks.some((result) => result.status === 'fulfilled' && result.value.some((frame) => frame.result === true));
}

// Everything needed to rebuild a window as it was.
async function captureWindow(win, focusedBefore) {
  const groups = Object.fromEntries((await chrome.tabGroups.query({ windowId: win.id }).catch(() => [])).map((g) => [g.id, { title: g.title, color: g.color, collapsed: g.collapsed }]));
  const scrolls = await Promise.allSettled(win.tabs.map((tab) => REOPENABLE.test(tab.url || '') && !tab.discarded
    ? chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ x: scrollX, y: scrollY }) }) : Promise.reject(new Error('skip'))));
  return {
    state: win.state, focused: win.id === focusedBefore,
    bounds: { left: win.left, top: win.top, width: win.width, height: win.height },
    groups,
    tabs: win.tabs.map((tab, i) => ({
      url: BLANK.test(tab.url || tab.pendingUrl || '') ? '' : (tab.url || tab.pendingUrl || ''),
      pinned: tab.pinned, active: tab.active, groupId: tab.groupId,
      scroll: scrolls[i].status === 'fulfilled' ? scrolls[i].value?.[0]?.result ?? null : null,
    })),
  };
}

async function strictHide(settings) {
  const state = await getState();
  if (state.lockWindowId == null) return;                                   // the lock window must exist first
  const record = (await store.get('strictRestore')) || [];
  const wins = await chrome.windows.getAll({ windowTypes: ['normal', 'app'], populate: true });
  const attempts = [];
  // Phase 1, fast: save each window's record, then close its tabs one by one.
  for (const win of wins) {
    if (win.id === state.lockWindowId || !covers(settings, win) || !win.tabs?.length) continue;
    if (await windowIsRisky(win)) {                                          // minimized by the normal path
      if (!(state.keptOpen || []).includes(win.id)) { await patchState({ keptOpen: [...(state.keptOpen || []), win.id] }); await logEvent(store, 'setting', 'kept a window open: unsaved typing, sound, or a page that cannot be reopened'); }
      continue;
    }
    const item = await captureWindow(win, state.focusedBefore);
    record.push(item);
    await store.set('strictRestore', record);                               // saved BEFORE closing, so nothing can be lost
    try { await chrome.tabs.remove(win.tabs.map((tab) => tab.id)); attempts.push({ id: win.id, item }); }   // complete hiding: the only place user tabs are closed
    catch (err) { record.splice(record.indexOf(item), 1); await store.set('strictRestore', record); await logEvent(store, 'setting', `could not close a window (${String(err?.message || err).slice(0, 80)})`); }
  }
  // Verify each window really closed. One that stayed open is forgotten (never "restored" as a duplicate) and minimized instead.
  if (attempts.length) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    for (const { id, item } of attempts) {
      let stillOpen = true;
      try { await chrome.windows.get(id); } catch { stillOpen = false; }
      if (stillOpen) { record.splice(record.indexOf(item), 1); await logEvent(store, 'setting', 'a window did not close, so it was minimized instead'); }
    }
    await store.set('strictRestore', record);
  }
}

// Scroll positions are put back once each rebuilt page has loaded.
async function applyPendingScroll(tabId) {
  const pending = (await store.get('pendingScroll')) || {};
  const scroll = pending[tabId];
  if (!scroll) return;
  delete pending[tabId];
  await store.set('pendingScroll', pending);
  chrome.scripting.executeScript({ target: { tabId }, func: (x, y) => scrollTo(x, y), args: [scroll.x || 0, scroll.y || 0] }).catch(() => {});
}

// Rebuild what complete hiding closed. Anything that cannot be rebuilt is reported.
async function strictRestore() {
  const record = (await store.get('strictRestore')) || [];
  if (!record.length) return;
  let failed = 0, focusId = null;
  const pending = (await store.get('pendingScroll')) || {};
  for (const item of record) {
    const urls = item.tabs.map((tab) => tab.url).filter((url) => REOPENABLE.test(url));
    try {
      const b = item.bounds || {};
      const win = await chrome.windows.create({ url: urls.length ? urls : undefined, focused: false, state: 'normal',
        ...(Number.isFinite(b.left) ? { left: b.left, top: b.top, width: b.width, height: b.height } : {}) });
      const created = (await chrome.tabs.query({ windowId: win.id })).sort((x, y) => x.index - y.index);
      const saved = item.tabs.filter((tab) => REOPENABLE.test(tab.url));
      const groupIds = new Map();
      for (let i = 0; i < created.length && i < saved.length; i++) {
        const tab = created[i], was = saved[i];
        if (was.pinned) await chrome.tabs.update(tab.id, { pinned: true }).catch(() => {});
        if (was.scroll && (was.scroll.x || was.scroll.y)) pending[tab.id] = was.scroll;
        if (was.groupId != null && was.groupId !== -1) {
          if (!groupIds.has(was.groupId)) groupIds.set(was.groupId, []);
          groupIds.get(was.groupId).push(tab.id);
        }
      }
      for (const [savedGroup, tabIds] of groupIds) {
        const info = item.groups?.[savedGroup];
        const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId: win.id } }).catch(() => null);
        if (groupId != null && info) await chrome.tabGroups.update(groupId, { title: info.title, color: info.color, collapsed: info.collapsed }).catch(() => {});
      }
      const activeIndex = saved.findIndex((tab) => tab.active);
      if (activeIndex >= 0 && created[activeIndex]) await chrome.tabs.update(created[activeIndex].id, { active: true }).catch(() => {});
      if (item.state === 'maximized') await chrome.windows.update(win.id, { state: 'maximized' }).catch(() => {});
      if (item.state === 'fullscreen') { try { await chrome.windows.update(win.id, { focused: true }); await chrome.windows.update(win.id, { state: 'fullscreen' }); } catch { /* it returns in its own state */ } }
      if (item.focused) focusId = win.id;
    } catch { failed++; }
  }
  await store.set('pendingScroll', pending);
  await store.set('strictRestore', []);
  if (focusId != null) { try { await chrome.windows.update(focusId, { focused: true }); } catch { /* gone */ } }
  if (failed) {
    await patchState({ error: `${failed} window${failed > 1 ? 's' : ''} could not be rebuilt. Your pages are in your browser history.` });
    await logEvent(store, 'setting', `${failed} window(s) could not be rebuilt`);
  }
}

// ---------- locking over the window itself ----------
// Browser pages (new tab, settings) and the web store cannot hold a cover, so a window whose visible tab is one of those would
// show through. Such a window is minimized like in the lock-window style; every other window is locked in place, untouched.
const BROWSER_PAGE = /^(chrome|brave|edge|about|chrome-extension|chrome-search|chrome-untrusted|devtools|view-source):/i;

async function pingCovered(tabId) {
  try {
    const reply = await Promise.race([chrome.tabs.sendMessage(tabId, { type: 'latch-ping' }, { frameId: 0 }), sleep(400).then(() => null)]);
    return reply?.covered === true;
  } catch { return false; }
}

// Why the tab you can see in this window does not carry the cover, or '' when it does.
async function whyExposed(win) {
  const [tab] = await chrome.tabs.query({ windowId: win.id, active: true });
  if (!tab) return '';
  if (BROWSER_PAGE.test(tab.url || tab.pendingUrl || '')) return 'it shows a browser page, which no extension can cover';
  if (await pingCovered(tab.id)) return '';
  // Not there yet: the page may have been open before Latch loaded, or still be loading. Put the script in and look again.
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['src/cover.js'] }); } catch { return 'the cover script could not be put into its page'; }   // a page scripts cannot run in
  for (let i = 0; i < 6; i++) { await sleep(150); if (await pingCovered(tab.id)) return ''; }
  return 'its page did not show the cover in time';
}

const notedExposed = new Set();
async function secureExposed(settings, { fresh }) {
  if (fresh) notedExposed.clear();
  const state = await getState();
  const forward = broughtForward;
  const wins = (await chrome.windows.getAll({ windowTypes: ['normal', 'app'] }))
    // A window we put away is skipped (the browser may still report it as "normal"), unless it was just brought forward again.
    .filter((win) => win.id !== state.lockWindowId && covers(settings, win) && win.state !== 'minimized' && (!minimizedAt.has(win.id) || win.id === forward));
  const exposed = [], visible = [], why = new Map();
  await Promise.all(wins.map(async (win) => { const reason = await whyExposed(win); if (reason) { exposed.push(win.id); why.set(win.id, reason); } else visible.push(win.id); }));
  for (const [id, reason] of why) {                                    // say so in Activity, once per window per lock
    if (!notedExposed.has(id)) { notedExposed.add(id); await logEvent(store, 'setting', `put a window away instead of covering it: ${reason}`); }
  }
  if (exposed.length) await minimizeWindows(settings, { full: fresh, only: exposed });
  broughtForward = null;
  // Nothing left to type the passcode into: open the small unlock window, so there is always a way back in.
  if (!visible.length) await ensureUnlockWindow();
}

async function ensureUnlockWindow() {
  const state = await getState();
  if (state.lockWindowId != null) {
    try { await chrome.windows.update(state.lockWindowId, { focused: true }); return; } catch { /* closed: open a new one */ }
  }
  const win = await chrome.windows.create({ url: LOCK_PAGE + '#small', type: 'popup', focused: true, width: 520, height: 700 });
  await patchState({ lockWindowId: win.id });
}

// Content scripts only run in pages that load after Latch is installed. Tabs that were already open, which is
// every tab after a reload or an update, are given the cover here, then the visible tab of each window is checked.
async function ensureCovers(settings) {
  if (!settings.coverPages) return;
  // Only the visible tab of each window; any other tab gets it when it is switched to (see onActivated below).
  const tabs = (await chrome.tabs.query({ active: true })).filter((tab) => covers(settings, tab) && !tab.discarded);
  await Promise.allSettled(tabs.map((tab) => chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['src/cover.js'] })));
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
async function ensureLockWindow(settings) {
  const state = await getState();
  if (state.lockWindowId != null) {
    try {
      const win = await chrome.windows.get(state.lockWindowId);
      await chrome.windows.update(win.id, { focused: true });
      return;
    } catch { /* it was closed; make a new one */ }
  }
  // Some browsers ignore a state passed at creation, so ask again once it exists. The lock page also reports the
  // real screen size ("fitLockWindow") as a fallback, so the lock window covers the screen on every platform.
  let win = await chrome.windows.create({ url: LOCK_PAGE, type: 'popup', focused: true, width: 1100, height: 760 });
  try { await chrome.windows.update(win.id, { state: settings?.lockWindow === 'fullscreen' ? 'fullscreen' : 'maximized' }); } catch { /* the fit below handles it */ }
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
    const win = await chrome.windows.create({ url: LOCK_PAGE + '#small', type: 'popup', focused: true, width: 520, height: 700 });
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
    // 1. Close our own window first, so nothing of ours is in the way.
    await closeLockWindow(state.lockWindowId);
    await strictRestore();                                           // windows closed by strict hiding reopen first
    // 2. Bring back what we hid. Every window we asked to minimize is asked to come back, because the browser may report
    //    "normal" for one that really is minimized. Full-screen windows go last: entering full screen is the animated step.
    const entries = Object.entries(state.windowStates).map(([id, saved]) => [Number(id), typeof saved === 'string' ? { state: saved } : saved]);
    entries.sort((a, b) => Number(a[1].state === 'fullscreen') - Number(b[1].state === 'fullscreen'));
    let focusId = null;
    for (const [id, saved] of entries) {
      try {
        if (saved.state === 'minimized') continue;                      // the user had it minimized: leave it that way
        if (saved.state === 'fullscreen') {
          await chrome.windows.update(id, { state: 'normal' });          // un-minimize
          await sleep(250);                                              // let the un-minimize animation finish
          await chrome.windows.update(id, { focused: true });            // it must be the active window to enter full screen
          await chrome.windows.update(id, { state: 'fullscreen' });
          await settleFullscreen(id);                                    // let the full-screen animation finish before anything else takes focus
          if ((await chrome.windows.get(id)).state !== 'fullscreen') {   // the browser did not take it (not the active window yet): once more
            await chrome.windows.update(id, { focused: true }); await sleep(400);
            await chrome.windows.update(id, { state: 'fullscreen' });
            await settleFullscreen(id);
            if ((await chrome.windows.get(id)).state !== 'fullscreen') await logEvent(store, 'setting', 'a window could not be returned to full screen');
          }
        } else {
          await chrome.windows.update(id, { state: saved.state === 'maximized' ? 'maximized' : 'normal' });   // un-minimize, whatever was reported
          if (saved.state !== 'maximized' && Number.isFinite(saved.left)) {
            const now = await chrome.windows.get(id);
            const drifted = [['left', saved.left], ['top', saved.top], ['width', saved.width], ['height', saved.height]].some(([k, v]) => Math.abs((now[k] ?? v) - v) > 3);
            if (drifted) await chrome.windows.update(id, { left: saved.left, top: saved.top, width: saved.width, height: saved.height });
          }
        }
        focusId = id;
      } catch { /* window is gone */ }
    }
    // 3. Give focus back to the window you were using.
    for (const candidate of [state.focusedBefore, focusId]) {
      if (candidate == null) continue;
      try {
        await chrome.windows.update(candidate, { focused: true });
        // A window that has just entered full screen can miss being made the active window while macOS is still switching
        // Spaces, and then ignores clicks and keys until it is minimized and restored. Check, and ask once more if needed.
        if (!(await chrome.windows.get(candidate)).focused) { await sleep(300); await chrome.windows.update(candidate, { focused: true }); }
        break;
      } catch { /* try the next */ }
    }
    await patchState({ lockWindowId: null, windowStates: {}, mutedTabs: [], failures: 0, focusedBefore: null, keptOpen: [] });
    return { ok: true };
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Wait (up to ~4 s) until the window really is full screen, then a moment for the Space switch to finish.
async function settleFullscreen(id) {
  for (let i = 0; i < 20; i++) {
    try { if ((await chrome.windows.get(id)).state === 'fullscreen') break; } catch { return; }
    await sleep(200);
  }
  await sleep(400);
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
  if (state.locked && windowId !== state.lockWindowId) enforceSoon(windowId);   // something else came to the front
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'blur') autoLock('The browser was in the background');
});

// Windows opened while locked (new window shortcut, session restore) are hidden at once.
chrome.windows.onCreated.addListener(async (win) => {
  if (win.type !== 'popup' && (await getState()).locked) enforceSoon();
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const state = await getState();
  if (windowId !== state.lockWindowId) return;
  await patchState({ lockWindowId: null });
  // "Everything" mode: closing the lock window brings it straight back. Private-only mode just stays covered.
  if (state.locked && (await getSettings()).scope === 'profile') setTimeout(() => enforceSoon(), 250);
});

// The overlay style only needs a look whenever the visible tab of some window may have changed.
const lockedOverlay = async () => (await getState()).locked && overlayStyle(await getSettings());
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const [state, settings] = await Promise.all([getState(), getSettings()]);
  if (!state.locked) return;
  // A tab switched to while locked gets the cover script at once (a tab open before Latch loaded has none yet).
  if (settings.coverPages) chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['src/cover.js'] }).catch(() => {});
  if (overlayStyle(settings)) enforceSoon();
});

chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  if ((change.url || change.status === 'loading') && (await lockedOverlay())) enforceSoon();
  if (change.status === 'complete') applyPendingScroll(tabId);
  if (change.status === 'complete' && (await getState()).locked) {
    chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['src/cover.js'] }).catch(() => {});   // a tab that finished loading while locked
  }
  if (change.audible && (await getState()).locked && (await getSettings()).muteTabs) serial(() => enforceLocked());
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
    mac: await isMac(),
    strictPending: ((await store.get('strictRestore')) || []).length,
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
  // A page cover reports that the unlock screen did not load in its page (a fixed sentence, nothing from the page).
  async coverNote() { await logEvent(store, 'setting', 'the unlock screen did not load inside a page, so the plain Unlock button was shown'); return { ok: true }; },

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

  // The lock page tells us the real screen, so the lock window can cover it where "maximized" is not honoured.
  async fitLockWindow({ left, top, width, height }, sender) {
    const state = await getState();
    const win = sender?.tab?.windowId;
    if (!state.locked || win == null || win !== state.lockWindowId) return { ok: false };
    const current = await chrome.windows.get(win);
    if (current.state === 'maximized' || current.state === 'fullscreen') return { ok: true };
    const ok = [left, top, width, height].every((n) => Number.isFinite(n)) && width > 200 && height > 200;
    if (ok) await chrome.windows.update(win, { left, top, width, height });
    return { ok };
  },

  async setBrowser({ brave }) { await store.set('browser', { brave: brave === true }); return { ok: true }; },

  // Switching strict hiding on: can this browser really close a window with several tabs without asking?
  async probeStrict() {
    if (!(await isMac())) return { ok: false, reason: 'mac-only' };
    if (await isBrave()) return { ok: false, reason: 'brave' };
    try {
      const probe = await chrome.windows.create({ url: ['about:blank', 'about:blank'], focused: false, width: 300, height: 200 });
      const tabs = await chrome.tabs.query({ windowId: probe.id });
      await chrome.tabs.remove(tabs.map((tab) => tab.id));                    // capability check: close a throwaway blank window of ours, tab by tab
      await new Promise((resolve) => setTimeout(resolve, 900));
      let stillOpen = true;
      try { await chrome.windows.get(probe.id); } catch { stillOpen = false; }
      return stillOpen ? { ok: false, reason: 'asks-first', windowId: probe.id } : { ok: true };
    } catch { return { ok: false, reason: 'error' }; }
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
  const fromCover = Boolean(sender.tab) && (message.type === 'openUnlockWindow' || message.type === 'coverNote');
  if (!fromOurPage && !fromCover) return false;
  handler(message, sender).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});
