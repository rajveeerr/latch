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
let PASS = 'hunter22';

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
  await options.click('#obStart');                                  // meet Kerby, then choose a passcode
  await options.fill('#newPasscode', PASS);
  await options.fill('#repeatPasscode', PASS);
  await options.click('#savePasscode');
  await options.waitForSelector('#recoverySheet:not([hidden])');
  const recoveryCode = await options.textContent('#recoveryValue');
  assert.match(recoveryCode, /^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);
  assert.equal(await options.isDisabled('#recoveryDone'), true, 'cannot continue before confirming the code is saved');
  await options.check('#recoverySaved');
  await options.click('#recoveryDone');
  await options.waitForSelector('#obPrivate:not([hidden])');       // onboarding carries on to private windows
  await options.click('#obSkip');
  await options.waitForSelector('#content:not([hidden])');
  ok('first run: onboarding sets a passcode, then a recovery code that must be acknowledged');
  // The checks below are about the separate lock window, so choose that style (the overlay has its own scenarios in windows.mjs).
  await options.evaluate(async (pass) => chrome.runtime.sendMessage({ type: 'saveSettings', settings: { ...(await chrome.runtime.sendMessage({ type: 'getSettings' })).settings, lockStyle: 'window' }, passcode: pass }), PASS);
  await options.reload(); await options.waitForSelector('#content:not([hidden])');      // so the form shows the style that is now saved

  // A page that is playing sound with an unsaved draft.
  const page = await context.newPage();
  await page.goto(site);
  await page.fill('#draft', 'unsaved draft text');
  await until(() => page.evaluate(async () => { const a = document.getElementById('a'); if (a.paused) await a.play().catch(() => {}); return !a.paused; }), 'audio to start playing', 15000);
  const tabsBefore = context.pages().map((p) => p.url()).filter((u) => !u.includes('lock.html')).sort();
  ok('sample page is playing audio with a half-typed draft');

  // Settings save as you change them. Loosening one asks for the passcode first.
  await options.bringToFront();
  await options.fill('#autoLockMinutes', '0');
  await options.press('#autoLockMinutes', 'Tab');          // saves when you leave the box, not on every keystroke
  await options.waitForSelector('#authRow:not([hidden])');
  await options.fill('#authPasscode', PASS);
  await options.click('#save');
  await options.waitForFunction(() => document.getElementById('saveMsg').textContent === 'Saved.');
  ok('loosening a setting asks for the passcode, then saves by itself');

  // Lock.
  await page.bringToFront();
  const windowBefore = await worker.evaluate(async () => (await chrome.windows.getLastFocused()).id);
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

  await page.focus('#draft');                       // even if something focuses the field, typing must not reach it
  await page.keyboard.type('ZZZ');
  assert.equal(await page.inputValue('#draft'), 'unsaved draft text', 'typing does not reach a covered page');
  ok('typing cannot reach the page behind the cover');

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
  assert.equal(await lock2.evaluate(() => getComputedStyle(document.getElementById('dialVisual')).getPropertyValue('--turn').trim()), '100.0deg', 'the knob turns a notch per character');
  await lock2.click('#unlock');
  await lock2.waitForFunction(() => document.getElementById('error').textContent.includes('Wrong'));
  await lock2.waitForSelector('#dialVisual.wrong');
  assert.ok(lockPage());
  ok('a wrong passcode is refused, and the lock rejects it');

  await lock2.fill('#passcode', PASS);
  await lock2.click('#unlock');
  await until(() => !lockPage(), 'lock window to close after unlocking');
  await until(() => page.evaluate(() => document.documentElement.lastElementChild.getAttribute('popover') !== 'manual'), 'cover to go away');
  const windowAfter = await worker.evaluate(async () => (await chrome.windows.getLastFocused()).id);
  assert.equal(windowAfter, windowBefore, 'focus returns to the window you were using');
  const leftover = await worker.evaluate(async () => (await chrome.windows.getAll({ windowTypes: ['popup'] })).length);
  assert.equal(leftover, 0, 'the lock window is gone');
  ok('the right passcode unlocks, removes the cover, closes the lock window and returns focus to your window');

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

  // ---------- Touch ID (a virtual authenticator stands in for the device) ----------
  const virtualAuthenticator = async (page) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: false, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    return { cdp, authenticatorId };
  };
  const settings2 = await context.newPage();
  const registered = await virtualAuthenticator(settings2);
  await settings2.goto(ext('ui/options.html'));
  await settings2.click('#touchSetup');
  await settings2.fill('#authPasscode', PASS);
  await settings2.click('#save');
  await settings2.waitForSelector('#touchRemove:not([hidden])');
  ok('Touch ID can be set up with the passcode (virtual authenticator)');

  await options.evaluate(() => chrome.runtime.sendMessage({ type: 'lock' }));
  const lockT = await until(lockPage, 'lock window for Touch ID');
  const forLock = await virtualAuthenticator(lockT);
  const { credentials } = await registered.cdp.send('WebAuthn.getCredentials', { authenticatorId: registered.authenticatorId });
  for (const credential of credentials) await forLock.cdp.send('WebAuthn.addCredential', { authenticatorId: forLock.authenticatorId, credential });
  await lockT.reload();
  await lockT.waitForSelector('#touchId:not([hidden])');
  await lockT.click('#touchId');
  await until(() => !lockPage(), 'unlock with Touch ID');
  ok('the lock screen offers Touch ID and unlocks with it');

  // ---------- forgot the passcode: the recovery code sets a new one ----------
  await options.evaluate(() => chrome.runtime.sendMessage({ type: 'lock' }));
  const lockR = await until(lockPage, 'lock window for recovery');
  await lockR.click('#forgot');
  await lockR.fill('#recoveryCode', 'AAAA-AAAA-AAAA-AAAA-AAAA');
  await lockR.fill('#newPass', 'brand new phrase');
  await lockR.fill('#newPass2', 'brand new phrase');
  await lockR.click('#recoverBtn');
  await lockR.waitForFunction(() => document.getElementById('recoverError').textContent.includes('not right'));
  ok('a wrong recovery code is refused');
  await lockR.fill('#recoveryCode', recoveryCode.toLowerCase().replaceAll('-', ' '));
  await lockR.click('#recoverBtn');
  await lockR.waitForSelector('#viewRecovered:not([hidden])');
  const newCode = await lockR.textContent('#newCode');
  assert.notEqual(newCode, recoveryCode, 'a fresh recovery code replaces the old one');
  assert.equal(await lockR.isDisabled('#finish'), true);
  await lockR.check('#savedCode');
  await lockR.click('#finish');
  await until(() => !lockPage(), 'unlock after recovery');
  PASS = 'brand new phrase';
  ok('the recovery code resets the passcode, issues a new code, and unlocks');

  // ---------- activity ----------
  await settings2.reload();
  const log = await settings2.locator('#activityList .event .title').allTextContents();
  assert.ok(log.some((t) => t.startsWith('Wrong')), `a wrong attempt is logged: ${log}`);
  assert.ok(log.includes('Unlocked'), 'unlocks are logged');
  assert.ok(log.some((t) => t.includes('recovery code')), 'the recovery reset is logged');
  ok('the activity log records wrong attempts, unlocks and the recovery reset');

  // ---------- "private windows only" without permission for private windows ----------
  const scoped = await options.evaluate(async (pass) => chrome.runtime.sendMessage({ type: 'saveSettings', settings: { ...(await chrome.runtime.sendMessage({ type: 'getSettings' })).settings, scope: 'private' }, passcode: pass }), PASS);
  assert.equal(scoped.ok, true, 'narrowing the scope works with the passcode');
  const tried = await options.evaluate(() => chrome.runtime.sendMessage({ type: 'lock' }));
  assert.deepEqual([tried.ok, tried.error], [false, 'incognito-not-allowed'], 'it refuses to pretend to lock');
  await settings2.reload();
  assert.match(await settings2.textContent('#statusTitle'), /Private windows cannot be locked yet/);
  assert.equal(await settings2.isDisabled('#lockNow'), true);
  await options.evaluate(async (pass) => chrome.runtime.sendMessage({ type: 'saveSettings', settings: { ...(await chrome.runtime.sendMessage({ type: 'getSettings' })).settings, scope: 'profile' }, passcode: pass }), PASS);
  ok('private-windows-only mode says so when it cannot work, instead of showing "protecting"');

  // ---------- previewing a style from Settings never touches the real lock ----------
  const previewPage = await context.newPage();
  await previewPage.goto(ext('ui/lock.html#preview'));
  await previewPage.fill('#passcode', 'wrong');
  await previewPage.click('#unlock');
  await previewPage.waitForFunction(() => document.getElementById('error').textContent.includes('Wrong'));
  await previewPage.fill('#passcode', 'anything');
  await previewPage.click('#unlock');
  await previewPage.waitForSelector('.stage.done');
  const afterPreview = await worker.evaluate(async () => (await chrome.storage.local.get('state')).state.locked);
  assert.equal(afterPreview, false, 'previewing does not lock anything');
  await previewPage.close();
  ok('the lock-screen preview is a safe demo that never locks or logs anything');

  // ---------- appearance: the lock screen layout and the mascot are real choices ----------
  await settings2.reload();
  await settings2.click('#layoutPicker .pick[data-layout="card"]');
  await settings2.click('#mascotPicker .pick[data-mascot="kerby"]');
  await settings2.waitForSelector('#heroArt svg.kerby');
  assert.equal(await settings2.getAttribute('#mascotPicker .pick[data-mascot="kerby"]', 'aria-checked'), 'true');
  assert.equal(await settings2.locator('#mascotPicker .pick svg').count(), 2, 'each mascot card shows a live preview of that mascot');
  await options.evaluate(() => chrome.runtime.sendMessage({ type: 'lock' }));
  const lockC = await until(lockPage, 'lock window in the card layout');
  await lockC.waitForSelector('#cardVisual', { state: 'visible' });
  assert.equal(await lockC.isVisible('#dialVisual'), false, 'only the chosen layout shows');
  assert.equal(await lockC.textContent('#cardName'), 'Kerby');
  await lockC.waitForSelector('#mascotSlot svg.kerby');
  await lockC.fill('#passcode', 'abc');
  assert.equal(await lockC.getAttribute('svg.kerby', 'data-state'), 'typing', 'the mascot reacts while you type');
  await lockC.fill('#passcode', PASS);
  await lockC.click('#unlock');
  await until(() => !lockPage(), 'unlock from the card layout');
  await settings2.click('#mascotPicker .pick[data-mascot="none"]');
  await settings2.waitForFunction(() => document.getElementById('overview').hasAttribute('data-nomascot'));
  await options.evaluate(() => chrome.runtime.sendMessage({ type: 'lock' }));
  const lockN = await until(lockPage, 'lock window with no mascot');
  await lockN.waitForSelector('#cardVisual', { state: 'visible' });
  assert.equal(await lockN.textContent('#cardName'), 'Latch', 'with no mascot the card is just Latch');
  assert.equal(await lockN.locator('#mascotSlot svg').count(), 0, 'and no mascot is drawn');
  await lockN.fill('#passcode', PASS);
  await lockN.click('#unlock');
  await until(() => !lockPage(), 'unlock with no mascot');
  await settings2.click('#layoutPicker .pick[data-layout="device"]');
  await settings2.click('#mascotPicker .pick[data-mascot="aegis"]');
  ok('lock-screen layout and mascot can be chosen (Kerby, Aegis or none), and the lock screen follows the choice');

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
