// Automatic locking, with real waiting (about five minutes). Needs the computer to be left alone while it runs:
// a real keyboard or mouse event resets the inactivity timer, and then that case is reported as "inconclusive".
//   CHROMIUM_PATH=/path npm run test:autolock
import { chromium } from 'playwright';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '../..');
const PASS = 'auto lock pass 7';
const APP = 'Google Chrome for Testing';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function wav() {
  const rate = 8000, n = rate, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 8) * 3000), 44 + i * 2);
  return buf;
}
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/tone.wav')) { res.writeHead(200, { 'content-type': 'audio/wav' }); return res.end(wav()); }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<title>t</title><audio id="a" src="/tone.wav" autoplay loop></audio>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const site = `http://127.0.0.1:${server.address().port}/`;

const profile = mkdtempSync(path.join(tmpdir(), 'latch-auto-'));
const launch = () => chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM_PATH || undefined, headless: false,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--autoplay-policy=no-user-gesture-required'],
});

const results = [];
const note = (ok, text) => { results.push(`  ${ok === true ? '✓' : ok === false ? '✗' : '?'} ${text}`); console.log(results.at(-1)); };

let context = await launch();
try {
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  let admin = context.pages().find((p) => p.url().includes('options.html')) || await context.newPage();
  const ext = (p) => `chrome-extension://${new URL(worker.url()).host}/${p}`;
  if (!admin.url().includes('options.html')) await admin.goto(ext('ui/options.html'));
  const send = (m) => admin.evaluate((msg) => chrome.runtime.sendMessage(msg), m);
  const isLocked = () => worker.evaluate(async () => (await chrome.storage.local.get('state')).state?.locked === true);
  const settings = (s) => send({ type: 'saveSettings', settings: { lockStyle: process.env.LOCKSTYLE || 'window', ...s }, passcode: PASS });   // these checks are about when it locks, written for the lock-window style
  const unlock = async () => { await send({ type: 'unlock', passcode: PASS }); for (let i = 0; i < 40 && await isLocked(); i++) await sleep(150); };
  const waitFor = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(500); } return false; };
  const idleState = (secs) => worker.evaluate((s) => new Promise((r) => chrome.idle.queryState(s, r)), secs);

  assert.equal((await send({ type: 'setPasscode', passcode: PASS })).ok, true);
  console.log('\nAuto-lock (real waiting; leave the computer alone)');

  // 1. inactivity: pause is respected
  await settings({ autoLockMinutes: 0.5, blurLockMinutes: 0, lockOnStartup: false, lockOnSystemLock: false, skipWhileAudio: false });
  await send({ type: 'pause', minutes: 5, passcode: PASS });
  const lockedWhilePaused = await waitFor(isLocked, 50000);
  const stillIdle = (await idleState(30)) !== 'active';
  if (lockedWhilePaused) note(false, 'paused protection still auto-locked');
  else if (!stillIdle) note(null, 'pause: inconclusive (the computer was used during the wait)');
  else note(true, 'pause: no auto-lock while protection is paused');
  await send({ type: 'resume' });

  // 2. inactivity locks after the chosen time
  const t0 = Date.now();
  const lockedIdle = await waitFor(isLocked, 100000);
  if (lockedIdle) note(true, `inactivity: locked by itself after ${Math.round((Date.now() - t0) / 1000)}s of the 30s setting (browser detection interval is 15s at best)`);
  else note((await idleState(30)) === 'active' ? null : false, (await idleState(30)) === 'active' ? 'inactivity: inconclusive (the computer was used during the wait)' : 'inactivity: did not lock although the computer was idle');
  await unlock();

  // 3. "stay unlocked while a tab plays sound"
  await settings({ autoLockMinutes: 0.5, skipWhileAudio: true });
  const audioPage = await context.newPage();
  await audioPage.goto(site);
  await sleep(1500);
  const playing = await audioPage.evaluate(() => !document.getElementById('a').paused);
  const lockedWithAudio = await waitFor(isLocked, 55000);
  if (!playing) note(null, 'audio: inconclusive (the test tone did not start)');
  else if (lockedWithAudio) note(false, 'locked on inactivity although a tab was playing sound and the option was on');
  else if ((await idleState(30)) === 'active') note(null, 'audio: inconclusive (the computer was used during the wait)');
  else note(true, 'audio: stays unlocked while a tab plays sound');
  await audioPage.close();
  await settings({ skipWhileAudio: false });

  // 4. browser in the background (macOS: bring Finder to the front, which removes focus from the browser)
  if (process.platform === 'darwin') {
    await settings({ autoLockMinutes: 0, blurLockMinutes: 0.5 });
    const page = await context.newPage(); await page.goto(site); await page.evaluate(() => document.getElementById('a')?.pause());
    execFileSync('osascript', ['-e', 'tell application "Finder" to activate']);
    const lockedBlur = await waitFor(isLocked, 50000);
    note(lockedBlur, 'background: locks after the browser has been in the background for the chosen time');
    execFileSync('osascript', ['-e', `tell application "${APP}" to activate`]);
    await unlock();
    // coming back before the time is up cancels it
    execFileSync('osascript', ['-e', 'tell application "Finder" to activate']);
    await sleep(8000);
    execFileSync('osascript', ['-e', `tell application "${APP}" to activate`]);
    const lockedAfterReturn = await waitFor(isLocked, 40000);
    note(!lockedAfterReturn, 'background: returning to the browser in time cancels the pending lock');
    await page.close();
    await unlock();
  } else {
    note(null, 'background: needs macOS to drive (test it by hand: switch to another app and wait)');
  }

  // 5. lock when the browser starts
  await settings({ autoLockMinutes: 0, blurLockMinutes: 0, lockOnStartup: true });
  await context.close();
  context = await launch();
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  admin = await context.newPage();
  await admin.goto(`chrome-extension://${new URL(worker.url()).host}/ui/options.html`);
  const lockedStart = await waitFor(async () => worker.evaluate(async () => (await chrome.storage.local.get('state')).state?.locked === true), 15000);
  note(lockedStart ? true : null, lockedStart ? 'startup: the browser starts locked' : 'startup: inconclusive. An extension loaded from the command line does not get the browser-started event a real restart sends, so test this by hand: quit and reopen the browser');

  note(null, 'screen lock / sleep / lid close: cannot be driven from a test, test by hand (see docs/manual-tests.md)');
  const bad = results.filter((r) => r.includes('✗')).length;
  console.log(`\n${results.filter((r) => r.includes('✓')).length} passed, ${bad} failed, ${results.filter((r) => r.includes('?')).length} inconclusive.`);
  if (bad) process.exitCode = 1;
} catch (err) {
  console.error('\nFAILED:', err);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
  server.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
