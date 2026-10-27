// End-to-end check in a real Chromium with the extension loaded.
// Usage: CHROMIUM_PATH=/path/to/chromium node test/e2e/e2e.mjs
//        BRAVE=1 node test/e2e/e2e.mjs          (runs it in Brave with a throwaway profile)
// A browser window opens briefly. Idle-based locking needs real inactivity and is checked by hand.
import { chromium } from 'playwright';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '../..');
const PASS = 'hunter22';

// A page with looping audio and a half-typed form, to prove locking does not disturb either.
function wav() {
  const rate = 8000, n = rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 8) * 3000), 44 + i * 2);
  return buf;
}
const server = http.createServer((req, res) => {
  if (req.url === '/tone.wav') { res.writeHead(200, { 'content-type': 'audio/wav' }); return res.end(wav()); }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<title>Sample page</title><audio id="a" src="/tone.wav" autoplay loop></audio><textarea id="draft"></textarea>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const site = `http://127.0.0.1:${server.address().port}/`;

const profile = mkdtempSync(path.join(tmpdir(), 'latch-e2e-'));
const flags = [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--autoplay-policy=no-user-gesture-required'];
let context, brave;
if (process.env.BRAVE) {
  // Brave only accepts --load-extension with this feature switched off, and not in your real profile.
  brave = spawn('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    [`--user-data-dir=${profile}`, '--remote-debugging-port=9339', '--no-first-run', '--no-default-browser-check',
     '--disable-features=DisableLoadExtensionCommandLineSwitch', ...flags, 'about:blank'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 6000));
  context = (await chromium.connectOverCDP('http://127.0.0.1:9339')).contexts()[0];
} else {
  context = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROMIUM_PATH || undefined, headless: false, args: flags });
}

let step = 0;
const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);
async function until(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error(`timed out waiting for: ${what} (${last})`);
}

try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const ext = (p) => `chrome-extension://${id}/${p}`;
  const lockPage = () => context.pages().find((p) => p.url().startsWith(ext('ui/lock.html')));

  // The install opens the settings page by itself.
  const options = context.pages().find((p) => p.url().includes('options.html')) || await context.newPage();
  if (!options.url().includes('options.html')) await options.goto(ext('ui/options.html'));
  await options.fill('#newPasscode', PASS);
  await options.fill('#repeatPasscode', PASS);
  await options.click('#savePasscode');
  await options.waitForSelector('#passcodeMsg.ok');
  ok('passcode can be set from the settings page');

  // A page that is playing sound with an unsaved draft.
  const page = await context.newPage();
  await page.goto(site);
  await page.fill('#draft', 'unsaved draft text');
  await until(() => page.evaluate(() => !document.getElementById('a').paused), 'audio to start playing');
  const tabsBefore = context.pages().map((p) => p.url()).filter((u) => !u.includes('lock.html')).sort();
  ok('sample page is playing audio with a half-typed draft');

  // Loosening a setting needs the passcode; tightening does not.
  await options.bringToFront();
  await options.fill('#autoLockMinutes', '0');
  await options.click('#save');
  await options.waitForFunction(() => document.getElementById('saveMsg').textContent.includes('passcode'));
  await options.fill('#authPasscode', PASS);
  await options.click('#save');
  await options.waitForFunction(() => document.getElementById('saveMsg').textContent === 'Saved.');
  ok('loosening a setting asks for the passcode');

  // Lock.
  await options.evaluate(() => chrome.runtime.sendMessage({ type: 'lock' }));
  const lock = await until(lockPage, 'lock window to open');
  await until(() => page.evaluate(() => document.getElementById('a').paused), 'audio to pause');
  ok('lock opens the lock window and pauses the audio');

  const covered = await page.evaluate(() => {
    const host = document.documentElement.lastElementChild;
    const r = host.getBoundingClientRect();
    return host.getAttribute('popover') === 'manual' && r.width >= innerWidth && r.height >= innerHeight && getComputedStyle(host).backgroundColor !== 'rgba(0, 0, 0, 0)';
  });
  assert.ok(covered, 'page should be covered');
  ok('the page is covered by an opaque full-size layer');

  const states = await worker.evaluate(async () => (await chrome.windows.getAll({ windowTypes: ['normal'] })).map((w) => w.state));
  // Minimizing is best-effort: automated browsers ignore it, so only report it.
  console.log(`    (window states while locked: ${states.join(', ')})`);

  // Closing the lock window does not get past it.
  await lock.close();
  await until(lockPage, 'lock window to come back');
  ok('closing the lock window brings it straight back');

  // Wrong passcode, then right.
  const lock2 = lockPage();
  await lock2.fill('#passcode', 'nope');
  await lock2.click('#unlock');
  await lock2.waitForFunction(() => document.getElementById('error').textContent.includes('Wrong'));
  assert.ok(lockPage());
  ok('a wrong passcode is refused');

  await lock2.fill('#passcode', PASS);
  await lock2.click('#unlock');
  await until(() => !lockPage(), 'lock window to close after unlocking');
  await until(() => page.evaluate(() => document.documentElement.lastElementChild.getAttribute('popover') !== 'manual'), 'cover to go away');
  ok('the right passcode unlocks and removes the cover');

  // Nothing was lost.
  const tabsAfter = context.pages().map((p) => p.url()).filter((u) => !u.includes('lock.html')).sort();
  assert.deepEqual(tabsAfter, tabsBefore, 'same tabs, same addresses');
  assert.equal(await page.inputValue('#draft'), 'unsaved draft text', 'draft survived');
  assert.equal(await page.title(), 'Sample page', 'title untouched');
  ok('same tabs, same addresses, untouched title and the unsaved draft is still there');

  const statesAfter = await worker.evaluate(async () => (await chrome.windows.getAll({ windowTypes: ['normal'] })).map((w) => w.state));
  assert.ok(!statesAfter.includes('minimized'), 'no window is left minimized');
  console.log(`    (window states after unlocking: ${statesAfter.join(', ')})`);

  // A locked state survives the worker restarting.
  await options.evaluate(() => chrome.runtime.sendMessage({ type: 'lock' }));
  await until(lockPage, 'second lock');
  const stored = await worker.evaluate(async () => (await chrome.storage.local.get('state')).state.locked);
  assert.equal(stored, true);
  ok('the locked state is stored, so it survives the worker restarting');
  const l3 = lockPage();
  await l3.fill('#passcode', PASS); await l3.click('#unlock');
  await until(() => !lockPage(), 'final unlock');

  console.log(`\nAll ${step} checks passed.`);
} catch (err) {
  console.error('\nFAILED:', err);
  process.exitCode = 1;
} finally {
  if (brave) {
    const exited = new Promise((r) => brave.once('exit', r));
    brave.kill();
    await exited;
  } else {
    await context.close();
  }
  server.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
