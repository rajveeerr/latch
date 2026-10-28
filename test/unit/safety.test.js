// These guard the promise that Latch never destroys browser data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sources = (dir) => readdirSync(path.join(root, dir), { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => [path.join(dir, f), read(path.join(dir, f))]);
const all = [...sources('src'), ...sources('ui')];

test('no code closes, reloads, discards or navigates tabs', () => {
  const banned = /chrome\.tabs\.(discard|reload|goBack|goForward|ungroup|move)\b|chrome\.bookmarks|chrome\.history|chrome\.browsingData|location\.(href|assign|replace)\s*=|window\.close\(\)/;
  for (const [file, code] of all) {
    if (file.endsWith('popup.js')) continue;   // the popup may close itself
    assert.ok(!banned.test(code), `${file} uses a forbidden call`);
  }
});

test('the only tabs Latch opens are its own settings page and the browser pages for extension options', () => {
  const allowed = [
    /^chrome\.tabs\.create\(\{ url: `chrome:\/\/extensions\/\?id=\$\{chrome\.runtime\.id\}` \}\)$/,   // allow in private windows
    /^chrome\.tabs\.create\(\{ url: 'chrome:\/\/extensions\/shortcuts' \}\)$/,                       // change the shortcut
    /^chrome\.tabs\.create\(\{ url: chrome\.runtime\.getURL\('ui\/options\.html' \+ hash\) \}\)$/,       // open Latch settings
    /^chrome\.tabs\.create\(\{ url: chrome\.runtime\.getURL\('ui\/lock\.html#preview'\) \}\)$/,                // preview the lock screen
  ];
  for (const [file, code] of all) {
    for (const match of code.matchAll(/chrome\.tabs\.create\(\{[^}]*\}\)/g)) {
      assert.ok(allowed.some((re) => re.test(match[0])), `${file} opens an unexpected tab: ${match[0]}`);
    }
  }
});

test('user tabs are only ever closed by complete hiding, behind its fences', () => {
  const background = read('src/background.js');
  assert.ok(!/chrome\.sessions/.test(background), 'no sessions API');
  const calls = [...background.matchAll(/chrome\.tabs\.remove\(/g)].length;
  assert.equal(calls, 2, 'exactly two call sites: complete hiding, and the capability probe on its own blank window');
  const hide = background.slice(background.indexOf('async function strictHide'), background.indexOf('// Scroll positions are put back'));
  assert.match(hide, /state\.lockWindowId == null\) return/, 'it waits for the lock window');
  assert.match(hide, /windowIsRisky\(win\)/, 'it skips windows with unsaved typing, sound or pages that cannot be reopened');
  assert.ok(hide.indexOf("store.set('strictRestore'") < hide.indexOf('chrome.tabs.remove('), 'the record is saved BEFORE anything is closed');
  assert.match(hide, /stillOpen/, 'and each window is verified afterwards');
  assert.match(background, /await isMac\(\)\) && !\(await isBrave\(\)\)\) await strictHide/, 'and it only runs on macOS, and never in Brave (where closing windows was measured to crash the browser)');
  const probe = background.slice(background.indexOf('async probeStrict'), background.indexOf('// ----- activity and incognito'));
  assert.match(probe, /url: \['about:blank', 'about:blank'\]/, 'the probe only ever closes a blank window it just made');
  for (const [file, code] of all) if (file !== path.join('src', 'background.js')) assert.ok(!/tabs\.remove|windows\.remove/.test(code), `${file} closes tabs or windows`);
});

test('windows.remove: only our own lock window', () => {
  const background = read('src/background.js');
  assert.equal([...background.matchAll(/chrome\.windows\.remove\(/g)].length, 1, 'one call site');
  assert.match(background, /isOurs = win\.type === 'popup' && win\.tabs\?\.length === 1 && win\.tabs\[0\]\.url\?\.startsWith\(LOCK_PAGE\)/);   // the lock window is verified
});

test('only the permissions Latch needs are requested', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.deepEqual([...manifest.permissions].sort(), ['alarms', 'idle', 'nativeMessaging', 'scripting', 'storage', 'tabGroups']);   // nativeMessaging: only to talk to the optional Latch helper
  assert.deepEqual(manifest.host_permissions, ['<all_urls>']);          // needed to put the cover into tabs that were already open
});

test('nothing talks to the network', () => {
  for (const [file, code] of all) assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon/.test(code) && !/https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(code), `${file} may use the network`);
});
