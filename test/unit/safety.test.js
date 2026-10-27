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
  const banned = /chrome\.tabs\.(remove|discard|reload|goBack|goForward|group|ungroup|move|create)\b|chrome\.bookmarks|chrome\.tabGroups|chrome\.sessions|chrome\.history|chrome\.browsingData|location\.(href|assign|replace)\s*=|window\.close\(\)/;
  for (const [file, code] of all) {
    if (file.endsWith('popup.js')) continue;   // the popup may close itself
    assert.ok(!banned.test(code), `${file} uses a forbidden call`);
  }
});

test('windows.remove appears once, behind the check that it is our own lock window', () => {
  const background = read('src/background.js');
  assert.equal([...background.matchAll(/chrome\.windows\.remove/g)].length, 1);
  assert.match(background, /isOurs = win\.type === 'popup' && win\.tabs\?\.length === 1 && win\.tabs\[0\]\.url\?\.startsWith\(LOCK_PAGE\)/);
  for (const [file, code] of all) if (file !== path.join('src', 'background.js')) assert.ok(!/windows\.remove/.test(code), `${file} closes windows`);
});

test('only the permissions Latch needs are requested', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.deepEqual([...manifest.permissions].sort(), ['alarms', 'idle', 'storage']);
  assert.equal(manifest.host_permissions, undefined);
});

test('nothing talks to the network', () => {
  for (const [file, code] of all) assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|https?:\/\//.test(code), `${file} may use the network`);
});
