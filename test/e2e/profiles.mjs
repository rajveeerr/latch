// Latch must only ever touch the profile it is installed in. Real Brave, two profiles in ONE browser process:
// Latch is loaded into the first, a window of the second is opened beside it, and locking must leave that window alone.
//   npm run test:profiles   (macOS, real Brave)
import { chromium } from 'playwright';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '../..');
const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const PASS = 'profile pass 5';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<title>${req.url}</title><textarea id="d"></textarea>`); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const site = (n) => `http://127.0.0.1:${server.address().port}/?t=${n}`;

const dir = mkdtempSync(path.join(tmpdir(), 'latch-prof-'));
mkdirSync(path.join(dir, 'Profile 2'), { recursive: true });
const common = [`--user-data-dir=${dir}`, '--remote-debugging-port=9343', '--no-first-run', '--no-default-browser-check', '--disable-features=DisableLoadExtensionCommandLineSwitch'];
const extFlags = [`--disable-extensions-except=${path.resolve(import.meta.dirname, '../..')}`, `--load-extension=${path.resolve(import.meta.dirname, '../..')}`];
let main, second;
let failed = false;
try {
  main = spawn(BRAVE, [...common, '--profile-directory=Default', ...extFlags, 'about:blank'], { stdio: 'ignore' });
  await sleep(6000);
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9343');
  const context = browser.contexts()[0];
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  let admin = context.pages().find((p) => p.url().includes('options.html')) || await context.newPage();
  if (!admin.url().includes('options.html')) await admin.goto(`chrome-extension://${id}/ui/options.html`);
  const send = (m) => admin.evaluate((msg) => chrome.runtime.sendMessage(msg), m);
  assert.equal((await send({ type: 'setPasscode', passcode: PASS })).ok, true);
  assert.equal((await send({ type: 'saveSettings', settings: { autoLockMinutes: 0, lockOnStartup: false, lockOnSystemLock: false, lockStyle: 'window' }, passcode: PASS })).ok, true);

  // a window of ANOTHER profile, in the same browser process
  second = spawn(BRAVE, [...common, '--profile-directory=Profile 2', site('other-profile')], { stdio: 'ignore' });
  await sleep(5000);
  const cdp = await browser.newBrowserCDPSession();
  const targets = (await cdp.send('Target.getTargets')).targetInfos.filter((t) => t.url.includes('other-profile'));
  assert.ok(targets.length, 'a window of the second profile is open in the same browser');
  const windowOf = async (targetId) => (await cdp.send('Browser.getWindowForTarget', { targetId })).bounds;
  const before = await windowOf(targets[0].targetId);

  const seen = await worker.evaluate(async () => (await chrome.windows.getAll({ windowTypes: ['normal', 'popup', 'app'] })).length);
  const mine = (await cdp.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page' && !t.url.includes('other-profile') && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('devtools')).length;
  console.log(`  windows Latch can see: ${seen}`);

  // a window with unsaved typing is never closed by strict mode, so the control page lives there
  await worker.evaluate(async (url) => { await chrome.windows.create({ url }); }, site('keeper'));
  await sleep(1500);
  const keeper = context.pages().find((p) => p.url() === site('keeper'));
  await keeper.fill('#d', 'unsaved');
  await worker.evaluate(async (url) => { const [w] = (await chrome.windows.getAll({ populate: true })).filter((x) => x.tabs.some((t) => t.url?.includes('keeper'))); await chrome.tabs.create({ windowId: w.id, url, active: false }); }, `chrome-extension://${id}/ui/options.html`);
  await sleep(1200);
  admin = context.pages().filter((p) => p.url().includes('options.html')).at(-1);
  for (const [mode, style] of [['minimize', 'window'], ['close', 'window'], ['minimize', 'overlay']]) {
    const label = style === 'overlay' ? 'overlay' : mode;
    assert.equal((await send({ type: 'saveSettings', settings: { hideMode: mode, lockStyle: style }, passcode: PASS })).ok, true);
    assert.equal((await send({ type: 'lock' })).ok, true);
    await sleep(2500);
    const after = await windowOf(targets[0].targetId);
    assert.equal(after.windowState, before.windowState, `${label}: the other profile's window state is untouched`);
    assert.ok(Math.abs(after.left - before.left) <= 2 && Math.abs(after.top - before.top) <= 2 && after.width === before.width && after.height === before.height, `${label}: bounds untouched`);
    const stillThere = (await cdp.send('Target.getTargets')).targetInfos.some((t) => t.url.includes('other-profile'));
    assert.ok(stillThere, `${label}: the other profile's window is still open`);
    const lockWins = await worker.evaluate(async () => (await chrome.windows.getAll({ windowTypes: ['popup'] })).length);
    if (style === 'window') assert.ok(lockWins >= 1, 'the lock window is up');
    assert.equal((await send({ type: 'unlock', passcode: PASS })).ok, true);
    await sleep(2500);
    console.log(`  ✓ ${label}: Latch locked its own profile and left the other profile's window completely alone`);
  }
  console.log('\n3 passed, 0 failed.');
} catch (err) {
  failed = true;
  console.error('\nFAILED:', err.message || err);
  process.exitCode = 1;
} finally {
  for (const p of [second, main]) { try { p?.kill(); } catch { /* gone */ } }
  await sleep(1500);
  spawn('pkill', ['-f', `user-data-dir=${dir}`]).on('error', () => {});
  await sleep(1500);
  server.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
}
