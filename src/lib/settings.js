// Settings: defaults, clamping, and the rule for what counts as "weakening" them.

export const DEFAULTS = Object.freeze({
  enabled: true,
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

const BOOLEANS = ['enabled', 'skipWhileAudio', 'lockOnStartup', 'lockOnSystemLock', 'minimizeWindows', 'coverPages', 'pauseMedia', 'muteTabs'];
const MINUTES = ['autoLockMinutes', 'blurLockMinutes'];

// Accepts anything (missing keys, wrong types, out-of-range numbers) and returns valid settings.
export function normalizeSettings(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = { ...DEFAULTS };
  for (const k of BOOLEANS) if (typeof src[k] === 'boolean') out[k] = src[k];
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
  for (const k of MINUTES) {
    if (prev[k] === 0) continue;                  // already off, nothing to weaken
    if (next[k] === 0 || next[k] > prev[k]) return true;
  }
  return false;
}
