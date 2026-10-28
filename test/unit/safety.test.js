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
  const banned = /chrome\.tabs\.(remove|discard|reload|goBack|goForward|group|ungroup|move)\b|chrome\.bookmarks|chrome\.tabGroups|chrome\.history|chrome\.browsingData|location\.(href|assign|replace)\s*=|window\.close\(\)/;
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

test('the sessions API is only used to list and restore recently closed windows', () => {
  for (const [file, code] of all) {
    for (const match of code.matchAll(/chrome\.sessions\.(\w+)/g)) {
      assert.ok(['getRecentlyClosed', 'restore'].includes(match[1]), `${file} uses chrome.sessions.${match[1]}`);
    }
  }
});

test('windows.remove: our own lock window, and the fenced strict-hiding path, and nowhere else', () => {
  const background = read('src/background.js');
  assert.equal([...background.matchAll(/chrome\.windows\.remove\(/g)].length, 3, 'exactly three call sites: the lock window, strict hiding, and the capability probe');
  const probe = background.slice(background.indexOf('async probeStrict'), background.indexOf('// ----- activity and incognito'));
  assert.match(probe, /url: \['about:blank', 'about:blank'\]/, 'the probe only ever closes a blank window it just made');
  assert.match(background, /isOurs = win\.type === 'popup' && win\.tabs\?\.length === 1 && win\.tabs\[0\]\.url\?\.startsWith\(LOCK_PAGE\)/);   // the lock window is verified
  const strict = background.slice(background.indexOf('async function strictHide'), background.indexOf('// Reopen what strict hiding closed'));
  assert.match(strict, /state\.lockWindowId == null\) return/, 'strict hiding waits for the lock window');
  assert.match(strict, /windowIsRisky\(win\)/, 'strict hiding skips windows with unsaved typing or sound');
  assert.match(strict, /store\.set\('strictRestore'/, 'and saves what it closed');
  assert.match(background, /await isMac\(\)\)\) await strictHide/, 'and only runs on macOS');
  for (const [file, code] of all) if (file !== path.join('src', 'background.js')) assert.ok(!/windows\.remove/.test(code), `${file} closes windows`);
});

test('only the permissions Latch needs are requested', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.deepEqual([...manifest.permissions].sort(), ['alarms', 'idle', 'scripting', 'sessions', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['<all_urls>']);          // needed to put the cover into tabs that were already open
});

test('nothing talks to the network', () => {
  for (const [file, code] of all) assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon/.test(code) && !/https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(code), `${file} may use the network`);
});
