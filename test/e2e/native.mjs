// The Latch helper end to end: the real helper program, started by a real browser through native messaging, draws a lock
// over each window, takes the passcode, and goes away on unlock. macOS only.
//   node test/e2e/native.mjs        (Chromium; set CHROMIUM_PATH if needed)
import { chromium } from 'playwright';
import http from 'node:http';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

if (process.platform !== 'darwin') { console.log('native helper test: macOS only, skipped'); process.exit(0); }

const root = path.resolve(import.meta.dirname, '../..');
const PASS = 'native pass 42';
const built = path.join(root, 'native/build/latch-helper');
execFileSync('sh', [path.join(root, 'native/build.sh'), '--fast'], { stdio: 'ignore' });
// Run a copy from a plain folder, like install.sh does: a browser may not be allowed to start programs inside Desktop or Documents.
const copyDir = mkdtempSync(path.join(tmpdir(), 'latch-helper-'));
const helper = path.join(copyDir, 'latch-helper');
execFileSync('cp', [built, helper]);
spawnSync(helper, [], { input: '', timeout: 30000 });        // start it once, as install.sh does: macOS checks a new program on its first launch

// The id an unpacked extension gets: SHA-256 of its folder path, written with the letters a-p.
const extId = createHash('sha256').update(root).digest('hex').slice(0, 32).replace(/./g, (c) => String.fromCharCode(97 + parseInt(c, 16)));

const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(`<title>${q.url}</title><body>native test page ${q.url}`); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const site = (n) => `http://127.0.0.1:${server.address().port}/?t=${n}`;

// A small tool that lists a process's windows as the window server sees them, on screen or not.
const DUMP = path.join(tmpdir(), 'latch-native-dump');
if (!existsSync(DUMP)) {
  writeFileSync(`${DUMP}.swift`, 'import Cocoa\nlet pid = Int32(CommandLine.arguments[1])!\nlet on = Set((CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]).map { $0[kCGWindowNumber as String] as! Int })\nfor w in CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as! [[String: Any]] where (w[kCGWindowOwnerPID as String] as? Int32) == pid && (w[kCGWindowLayer as String] as? Int) == 0 { let b = w[kCGWindowBounds as String] as! [String: Any]; let n = w[kCGWindowNumber as String] as! Int; print("\\(n) \\(on.contains(n) ? 1 : 0) \\(Int(b["X"] as! Double)) \\(Int(b["Y"] as! Double)) \\(Int(b["Width"] as! Double)) \\(Int(b["Height"] as! Double))") }\n');
  execFileSync('swiftc', [`${DUMP}.swift`, '-o', DUMP], { stdio: 'ignore' });
}
const windowsOf = (pid) => execFileSync(DUMP, [String(pid)], { encoding: 'utf8' }).split('\n').filter(Boolean).map((l) => { const [n, on, x, y, w, h] = l.split(' ').map(Number); return { n, on: on === 1, x, y, w, h }; }).filter((w) => w.on && w.w > 120 && w.h > 80);
const helperPids = () => { try { return execFileSync('pgrep', ['-f', helper], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(Number); } catch { return []; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 10000) { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(100); } throw new Error(`timed out waiting for: ${what} (${last})`); }

// A throwaway-profile Brave reads Chrome's real hosts folder. If a real install is there, the test would use it instead of its own
// helper, so say so and stop before starting anything.
if (process.env.BRAVE && existsSync(path.join(homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.latch.helper.json'))) {
  console.log('  (skipped: a real Latch helper is installed for Chrome and Brave on this Mac, and a throwaway Brave would use it. Run "Uninstall Latch Helper" to test in Brave.)');
  process.exit(0);
}
const profile = mkdtempSync(path.join(tmpdir(), 'latch-native-'));
let context, brave, wroteHostFile, passed = 0, failed = 0;
async function check(name, fn) { try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n      ${String(e.message || e).split('\n')[0]}`); } }

try {
  process.env.LATCH_HELPER_TEST = '1';                       // the helper inherits the browser's environment
  const flags = [`--disable-extensions-except=${root}`, `--load-extension=${root}`];
  if (process.env.BRAVE) {                                    // BRAVE=1: the same checks in real Brave, throwaway profile
    brave = spawn('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', [`--user-data-dir=${profile}`, '--remote-debugging-port=9343', '--no-first-run', '--no-default-browser-check', '--disable-features=DisableLoadExtensionCommandLineSwitch', ...flags, 'about:blank'], { stdio: 'ignore' });
    await sleep(6000);
    context = (await chromium.connectOverCDP('http://127.0.0.1:9343')).contexts()[0];
  } else {
    context = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROMIUM_PATH || undefined, headless: false, args: flags });
  }
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  assert.equal(new URL(worker.url()).host, extId, 'the id the installer would compute matches the real one');
  const admin = context.pages().find((p) => p.url().includes('options.html')) || await context.newPage();
  if (!admin.url().includes('options.html')) await admin.goto(`chrome-extension://${extId}/ui/options.html`);
  const send = (m) => admin.evaluate((msg) => chrome.runtime.sendMessage(msg), m);
  const W = (fn, ...args) => worker.evaluate(([f, a]) => new Function('return ' + f)()(...a), [fn.toString(), args]);
  await W(async () => { await chrome.storage.local.set({ testHooks: true }); });         // lets the helper's self-test messages through
  assert.equal((await send({ type: 'setPasscode', passcode: PASS })).ok, true);
  assert.equal((await send({ type: 'saveSettings', settings: { autoLockMinutes: 0, lockOnStartup: false, lockOnSystemLock: false, lockStyle: 'native' }, passcode: PASS })).ok, true);
  const browserPid = brave ? brave.pid : Number(execFileSync('pgrep', ['-f', `user-data-dir=${profile}`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)[0]);
  const flag = () => W(async () => (await chrome.storage.local.get('state')).state.locked === true);
  const popups = () => W(async () => (await chrome.windows.getAll({ windowTypes: ['popup'] })).length);
  const create = (o) => W(async (opts) => (await chrome.windows.create(opts)).id, o);
  const info = (id) => W(async (i) => { const w = await chrome.windows.get(i); return { state: w.state, left: w.left, top: w.top, width: w.width, height: w.height }; }, id);
  const events = async () => (await send({ type: 'getActivity' })).events.map((e) => e.detail);

  // ---- 1. no helper installed: the lock still works, drawn in the pages ----
  await check('without the helper installed, a native lock falls back to the in-page overlay and says so', async () => {
    const w = await create({ url: site('fallback'), left: 60, top: 60, width: 700, height: 500, state: 'normal' });
    const page = await until(() => context.pages().find((p) => p.url().endsWith('?t=fallback')), 'the page', 10000); await sleep(500);
    assert.equal((await send({ type: 'lock' })).ok, true);
    await until(flag, 'locked');
    await until(async () => page.evaluate(() => Boolean(document.querySelector('[data-latch-cover]'))), 'the page to be covered');
    await until(() => page.frames().find((f) => f.url().includes('ui/lock.html')), 'the in-page unlock screen');
    assert.ok((await events()).some((e) => e.includes('helper is not running')), 'Activity says the helper was not used');
    const probe = await send({ type: 'probeHelper' });
    assert.deepEqual([probe.ok, probe.problem], [false, 'missing'], 'settings can tell it is not installed');
    assert.equal((await send({ type: 'getStatus' })).helperNudge, true, 'the toolbar popup offers the helper after a lock that fell back');
    assert.equal((await send({ type: 'unlock', passcode: PASS })).ok, true);
    await until(async () => !(await flag()), 'unlocked');
    await W((i) => chrome.windows.remove(i), w);
  });

  // ---- 2. install the helper for this profile only, as install.sh would for a real one ----
  // Chromium reads hosts from the profile folder. A throwaway-profile Brave reads a real folder instead, so the Brave run puts the
  // same small file there for the length of the test, and only if nothing is there already (it never overwrites a real install).
  const manifest = JSON.stringify({ name: 'com.latch.helper', description: 'test', path: helper, type: 'stdio', allowed_origins: [`chrome-extension://${extId}/`] });
  const hosts = brave ? path.join(homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts') : path.join(profile, 'NativeMessagingHosts');   // a throwaway-profile Brave reads Chrome's folder
  mkdirSync(hosts, { recursive: true });
  const hostFile = path.join(hosts, 'com.latch.helper.json');
  const wrong = JSON.stringify({ name: 'com.latch.helper', description: 'test', path: helper, type: 'stdio', allowed_origins: ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'] });
  const realFile = existsSync(hostFile);

  if (!realFile) { writeFileSync(hostFile, wrong); wroteHostFile = hostFile; }
  if (!realFile) await check('a helper installed for a different Latch folder is recognised as that, not as missing', async () => {
    const probe = await send({ type: 'probeHelper' });
    assert.deepEqual([probe.ok, probe.problem], [false, 'forbidden']);
  });
  if (!realFile) await check('settings notice the install by themselves: the card flips to "Helper found" with no click and no reload', async () => {
    await admin.reload(); await admin.waitForSelector('#content:not([hidden])');
    await until(async () => (await admin.textContent('#helperTitle')).includes('another folder'), 'the card to say it is installed for another folder', 8000);
    writeFileSync(hostFile, manifest);                      // the install happens
    await until(async () => (await admin.textContent('#helperTitle')).includes('Helper found'), 'the card to notice', 12000);
    await until(() => helperPids().length === 0, 'the check helper to quit again', 6000);
  });
  if (!realFile) writeFileSync(hostFile, manifest);
  await check('the helper starts, says hello, and settings can see it (and the popup stops offering it)', async () => {
    assert.equal((await send({ type: 'probeHelper' })).ok, true);
    assert.equal((await send({ type: 'getStatus' })).helperNudge, false);
    await until(() => helperPids().length === 0, 'the probe helper to quit again', 6000);
  });

  let a, aBefore;
  await check('lock: the helper puts a lock exactly over each window; no window opens; nothing moves or minimizes', async () => {
    a = await create({ url: site('a'), left: 90, top: 90, width: 800, height: 560, state: 'normal' });
    await until(() => context.pages().find((p) => p.url().endsWith('?t=a')), 'the page', 10000); await sleep(600);
    const before = await info(a); aBefore = before; const popupsBefore = await popups();
    assert.equal((await send({ type: 'lock' })).ok, true);
    await until(flag, 'locked');
    const pid = await until(() => helperPids().at(-1), 'the helper to be running', 6000);
    const overlays = await until(() => { const o = windowsOf(pid); return o.length >= 2 ? o : null; }, 'overlays on screen', 6000);
    const browserWins = windowsOf(browserPid);
    assert.ok(browserWins.length >= 2, 'the browser windows are on screen to be checked');
    for (const bw of browserWins) {
      assert.ok(overlays.some((o) => Math.abs(o.x - bw.x) <= 3 && Math.abs(o.y - bw.y) <= 3 && Math.abs(o.w - bw.w) <= 3 && Math.abs(o.h - bw.h) <= 3), `a lock sits exactly over the window at ${bw.x},${bw.y} ${bw.w}x${bw.h}`);
    }
    if (process.env.SHOT) { await sleep(500); await send({ type: 'helperSelfTest', snapshot: process.env.SHOT }); await sleep(500); }   // the lock screen only, never the display
    assert.equal(await popups(), popupsBefore, 'no lock window opened');
    const after = await info(a);
    assert.deepEqual(after, before, 'the window did not move, resize or minimize');
  });

  await check('a wrong passcode typed into the helper keeps it locked and is counted', async () => {
    assert.equal((await send({ type: 'helperSelfTest', passcode: 'not it' })).ok, true);
    await until(async () => (await send({ type: 'getActivity' })).events.some((e) => e.type === 'failed'), 'the failed attempt to be recorded', 6000);
    assert.equal(await flag(), true, 'still locked');
    assert.ok(helperPids().length >= 1, 'the helper is still there');
  });

  await check('if the helper reports nothing to cover, the pages show their own unlock screen, so a lock is never invisible', async () => {
    const nativeUp = () => W(async () => (await chrome.storage.local.get('state')).state.nativeUp === true);
    assert.equal(await nativeUp(), true, 'the helper is drawing the lock');
    assert.equal((await send({ type: 'helperSelfTest', coverage: { overlays: 0, browserWindows: 3 } })).ok, true);
    await until(async () => !(await nativeUp()), 'the pages to take over', 5000);
    assert.ok((await events()).some((e) => e.includes('found no window of this profile to cover')), 'Activity says why');
    assert.equal((await send({ type: 'helperSelfTest', coverage: { overlays: 2, browserWindows: 3 } })).ok, true);
    await until(nativeUp, 'the helper to be trusted again once it covers windows', 5000);
  });

  await check('a fingerprint reported by the helper does nothing unless Touch ID is switched on, and unlocks when it is', async () => {
    assert.equal((await send({ type: 'helperSelfTest', biometric: true })).ok, true);
    await sleep(1200);
    assert.equal(await flag(), true, 'Touch ID is off, so a reported fingerprint is ignored');
    assert.equal((await send({ type: 'saveSettings', settings: { ...(await send({ type: 'getSettings' })).settings, helperTouchId: true }, passcode: PASS })).ok, true);
    assert.equal((await send({ type: 'helperSelfTest', biometric: true })).ok, true);
    await until(async () => !(await flag()), 'unlocked by the fingerprint', 6000);
    assert.ok((await send({ type: 'getActivity' })).events.some((e) => e.type === 'unlock' && e.detail === 'touchid'), 'Activity says it was Touch ID');
    await until(() => helperPids().length === 0, 'the helper to quit', 8000);
    // back to a locked state for the next checks
    assert.equal((await send({ type: 'lock' })).ok, true);
    await until(flag, 'locked again');
    await until(() => helperPids().length >= 1, 'the helper again', 6000);
  });

  await check('the right passcode unlocks, the lock goes away, and the helper quits', async () => {
    assert.equal((await send({ type: 'helperSelfTest', passcode: PASS })).ok, true);
    await until(async () => !(await flag()), 'unlocked', 6000);
    const pids = helperPids();
    await until(() => helperPids().length === 0, 'the helper to quit', 8000);
    assert.ok(pids.length >= 1);
    assert.deepEqual(await info(a), aBefore, 'the window is exactly as it was before the lock');
  });

  await check('an automatic lock (the same timer the "browser in the background" lock uses) puts the helper lock up too, and unlocking works', async () => {
    assert.equal(await flag(), false, 'unlocked to start with');
    await W(async () => { chrome.alarms.create('blur', { when: Date.now() + 600 }); });
    await until(flag, 'the automatic lock to engage', 8000);
    const pid = await until(() => helperPids().at(-1), 'the helper to start for it', 8000);
    await until(() => { const o = windowsOf(pid); return o.length >= 1 ? o : null; }, 'the helper lock to be on screen', 8000);
    assert.ok((await events()).some((e) => e.includes('background')), 'Activity says why it locked');
    assert.equal((await send({ type: 'helperSelfTest', passcode: PASS })).ok, true);
    await until(async () => !(await flag()), 'unlocked', 6000);
    await until(() => helperPids().length === 0, 'the helper to quit', 8000);
  });

  await check('locking again right after an unlock keeps the helper: its shutdown timer must not close the new lock', async () => {
    assert.equal((await send({ type: 'lock' })).ok, true);
    await until(flag, 'locked');
    await until(() => helperPids().length >= 1, 'the helper', 6000);
    assert.equal((await send({ type: 'helperSelfTest', passcode: PASS })).ok, true);
    await until(async () => !(await flag()), 'unlocked', 6000);
    assert.equal((await send({ type: 'lock' })).ok, true);              // straight away, inside the helper's 1 s shutdown window
    await until(flag, 'locked again');
    await sleep(2500);                                                  // past the old timer
    const pid = await until(() => helperPids().at(-1), 'the helper to still be there', 4000);
    assert.ok(windowsOf(pid).length >= 1, 'and it is still drawing the lock');
    assert.equal(await W(async () => (await chrome.storage.local.get('state')).state.nativeUp === true), true);
    assert.equal((await send({ type: 'helperSelfTest', passcode: PASS })).ok, true);
    await until(async () => !(await flag()), 'unlocked', 6000);
    await until(() => helperPids().length === 0, 'the helper to quit', 8000);
  });

  await check('a maximized window, and a window minimized then restored while locked: each is covered exactly, nothing is resized or moved', async () => {
    const m = await create({ url: site('max'), left: 40, top: 40, width: 700, height: 500, state: 'normal' });
    await W((i) => chrome.windows.update(i, { state: 'maximized' }), m);
    await until(async () => (await info(m)).state === 'maximized', 'maximized', 10000); await sleep(1000);
    const n = await create({ url: site('mini'), left: 200, top: 120, width: 640, height: 460, state: 'normal' });
    await sleep(1000);
    const beforeM = await info(m), beforeN = await info(n);
    assert.equal((await send({ type: 'lock' })).ok, true);
    await until(flag, 'locked');
    const pid = await until(() => helperPids().at(-1), 'the helper', 6000);
    const coversAll = () => { const o = windowsOf(pid); const shown = windowsOf(browserPid); return shown.length > 0 && shown.every((bw) => o.some((x) => Math.abs(x.x - bw.x) <= 3 && Math.abs(x.y - bw.y) <= 3 && Math.abs(x.w - bw.w) <= 3 && Math.abs(x.h - bw.h) <= 3)); };
    await until(coversAll, 'every window, the maximized one included, to be covered exactly', 6000);
    const maxSize = windowsOf(browserPid).sort((x, y) => y.w * y.h - x.w * x.h)[0];
    assert.ok(maxSize.w >= 1000, 'the maximized window really is screen sized');
    // minimize one while locked: it leaves the screen, and the lock leaves with it; restoring it brings the lock straight back
    const countBefore = windowsOf(browserPid).length;
    await W((i) => chrome.windows.update(i, { state: 'minimized' }), n);
    const minimized = await until(() => windowsOf(browserPid).length < countBefore, 'the window to leave the screen', 6000).then(() => true, () => false);
    if (!minimized) console.log('      (this browser did not minimize the window under automation, so the minimize-and-restore leg was not exercised)');
    await W((i) => chrome.windows.update(i, { state: 'normal' }), n);
    await until(() => windowsOf(browserPid).length >= countBefore, 'the window to come back', 6000);
    await until(coversAll, 'the restored window to be covered again', 4000);
    assert.deepEqual(await info(m), beforeM, 'the maximized window was not resized or moved');
    const afterN = await info(n);
    assert.ok(['left', 'top', 'width', 'height'].every((k) => Math.abs(afterN[k] - beforeN[k]) <= 2), 'the restored window is where it was');
    assert.equal((await send({ type: 'helperSelfTest', passcode: PASS })).ok, true);
    await until(async () => !(await flag()), 'unlocked', 6000);
    await W((i) => chrome.windows.remove(i), m); await W((i) => chrome.windows.remove(i), n);
  });

  await check('a window in full screen is covered where it is, with no window opened', async () => {
    const f = await create({ url: site('fs'), left: 50, top: 50, width: 900, height: 600, state: 'normal' });
    await W((i) => chrome.windows.update(i, { state: 'fullscreen' }), f);
    await until(async () => (await info(f)).state === 'fullscreen', 'fullscreen', 20000); await sleep(1200);
    const popupsBefore = await popups();
    assert.equal((await send({ type: 'lock' })).ok, true);
    await until(flag, 'locked');
    const pid = await until(() => helperPids().at(-1), 'the helper', 6000);
    // In full screen the browser draws its page, toolbar, tab strip and menu bar as separate windows. Every one that is on screen
    // must have a lock exactly over it, not just one screen-sized lock somewhere.
    await sleep(1500);
    const pieces = windowsOf(browserPid).filter((w) => w.w >= 1000);
    assert.ok(pieces.length >= 1, 'the full-screen window is on screen');
    const overlays = windowsOf(pid);
    for (const bw of pieces) assert.ok(overlays.some((o) => Math.abs(o.x - bw.x) <= 3 && Math.abs(o.y - bw.y) <= 3 && Math.abs(o.w - bw.w) <= 3 && Math.abs(o.h - bw.h) <= 3), `a lock sits over the piece of the full-screen window at ${bw.x},${bw.y} ${bw.w}x${bw.h}`);
    assert.equal(await popups(), popupsBefore);
    assert.equal((await info(f)).state, 'fullscreen', 'still in full screen');
    assert.equal((await send({ type: 'helperSelfTest', passcode: PASS })).ok, true);
    await until(async () => !(await flag()), 'unlocked', 6000);
    assert.equal((await info(f)).state, 'fullscreen', 'and still in full screen after unlocking');
    await W((i) => chrome.windows.remove(i), f);
  });
} catch (err) {
  failed++; console.log('FAILED:', err.message || err);
} finally {
  rmSync(copyDir, { recursive: true, force: true });
  if (wroteHostFile) rmSync(wroteHostFile, { force: true });        // leave the real Brave folder as it was
  for (const pid of helperPids()) { try { process.kill(pid); } catch { /* gone */ } }
  if (brave) { try { brave.kill(); } catch { /* gone */ } await sleep(1500); } else await context?.close().catch(() => {});
  server.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
}
console.log(`\n${passed} passed, ${failed} failed.`);
process.exitCode = failed ? 1 : 0;
