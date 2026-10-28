// Settings: defaults, clamping, and the rule for what counts as "weakening" them.

export const DEFAULTS = Object.freeze({
  enabled: true,
  hideMode: 'minimize',      // 'minimize' = windows go to the Dock (safe, the default); 'close' = experimental: windows are closed and rebuilt on unlock (macOS, never in Brave)
  lockStyle: 'native',       // 'native' = the Latch helper draws the lock over each window (falls back to 'overlay' if it is not installed); 'overlay' = the lock sits in the page; 'window' = a separate lock window over the screen and the windows are minimized
  helperTouchId: false,      // the Latch helper may offer Touch ID on its lock screen (the passcode always works)
  lockWindow: 'fill',        // 'fill' = cover the screen; 'fullscreen' = full screen, which also hides the Dock and menu bar (lock-window style only)
  scope: 'profile',          // 'profile' = lock everything; 'private' = lock only private windows (like Safari)
  autoLockMinutes: 5,        // lock after this long with no keyboard/mouse input; 0 = never
  blurLockMinutes: 0,        // lock after the browser has been in the background this long; 0 = never
  skipWhileAudio: false,     // do not auto-lock on inactivity while a tab is playing sound
  lockOnStartup: true,
  lockOnSystemLock: true,    // screen lock / sleep
  minimizeWindows: true,     // minimize this profile's windows while locked (restored on unlock)
  coverPages: true,          // opaque cover over every page
  pauseMedia: true,          // pause <video>/<audio> on every page
  muteTabs: true,            // mute tabs that are playing sound (unmuted on unlock)
});

const SCOPES = ['profile', 'private'];
const LOCK_STYLES = ['native', 'overlay', 'window'];
const LOCK_WINDOWS = ['fill', 'fullscreen'];
const HIDE_MODES = ['minimize', 'close'];
const BOOLEANS = ['enabled', 'helperTouchId', 'skipWhileAudio', 'lockOnStartup', 'lockOnSystemLock', 'minimizeWindows', 'coverPages', 'pauseMedia', 'muteTabs'];
const MINUTES = ['autoLockMinutes', 'blurLockMinutes'];

// Accepts anything (missing keys, wrong types, out-of-range numbers) and returns valid settings.
export function normalizeSettings(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = { ...DEFAULTS };
  for (const k of BOOLEANS) if (typeof src[k] === 'boolean') out[k] = src[k];
  if (SCOPES.includes(src.scope)) out.scope = src.scope;
  if (LOCK_STYLES.includes(src.lockStyle)) out.lockStyle = src.lockStyle;
  if (LOCK_WINDOWS.includes(src.lockWindow)) out.lockWindow = src.lockWindow;
  if (HIDE_MODES.includes(src.hideMode)) out.hideMode = src.hideMode;
  for (const k of MINUTES) {
    const n = Number(src[k]);
    if (src[k] !== undefined && Number.isFinite(n)) {
      out[k] = n <= 0 ? 0 : Math.min(1440, Math.max(0.5, Math.round(n * 2) / 2));
    }
  }
  return out;
}

// True when `next` protects less than `prev`. Weakening changes ask for the passcode.
export function isWeakening(prev, next) {
  if (prev.enabled && !next.enabled) return true;
  for (const k of ['lockOnStartup', 'lockOnSystemLock', 'minimizeWindows', 'coverPages', 'pauseMedia', 'muteTabs']) {
    if (prev[k] && !next[k]) return true;
  }
  if (!prev.skipWhileAudio && next.skipWhileAudio) return true;
  if (!prev.helperTouchId && next.helperTouchId) return true;                   // a second way in
  if (prev.hideMode === 'close' && next.hideMode === 'minimize') return true;     // strict hiding is stronger
  if (prev.lockStyle !== 'overlay' && next.lockStyle === 'overlay') return true;   // the tab strip stays visible under an in-page overlay; the other two hide it
  if (prev.lockStyle === 'window' && next.lockStyle !== 'window') return true;     // 'native' falls back to the overlay without the helper, so leaving the lock window is a loosening too
  if (prev.scope === 'profile' && next.scope === 'private') return true;     // protects less
  for (const k of MINUTES) {
    if (prev[k] === 0) continue;                  // already off, nothing to weaken
    if (next[k] === 0 || next[k] > prev[k]) return true;
  }
  return false;
}

// The in-page overlay needs the page cover, so without it the lock falls back to the separate lock window.
export const overlayStyle = (settings) => settings.lockStyle !== 'window' && settings.coverPages;   // 'native' counts: it falls back to the overlay when the helper is missing

// Which windows and tabs a lock applies to. "Private windows only" leaves everything else alone.
export function covers(settings, item) {
  return settings.scope === 'profile' || item.incognito === true;
}
