// Repeats lock and unlock many times in a fresh real Brave and counts crashes.
//   HIDE=close|minimize ROUNDS=12 node test/e2e/stress.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const MODE = process.env.HIDE || 'close', ROUNDS = Number(process.env.ROUNDS || 12), PASS = 'stress pass 1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<title>${req.url}</title><textarea id="d"></textarea><div style="height:3000px">${req.url}</div>`); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const site = (n) => `http://127.0.0.1:${server.address().port}/?t=${n}`;
const dir = mkdtempSync(path.join(tmpdir(), 'latch-stress-'));
const brave = spawn('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', [`--user-data-dir=${dir}`, '--remote-debugging-port=9351', '--no-first-run', '--no-default-browser-check', '--disable-features=DisableLoadExtensionCommandLineSwitch', `--disable-extensions-except=${root}`, `--load-extension=${root}`, 'about:blank'], { stdio: 'ignore' });
let crashed = null;
brave.on('exit', (code, signal) => { if (!crashed && signal !== 'SIGTERM') crashed = `code=${code} signal=${signal}`; });
let completed = 0;
try {
  await sleep(6000);
  const context = (await chromium.connectOverCDP('http://127.0.0.1:9351')).contexts()[0];
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  let admin = context.pages().find((p) => p.url().includes('options.html')) || await context.newPage();
  if (!admin.url().includes('options.html')) await admin.goto(`chrome-extension://${id}/ui/options.html`);
  const send = (m) => admin.evaluate((msg) => chrome.runtime.sendMessage(msg), m);
  await send({ type: 'setPasscode', passcode: PASS });
  await send({ type: 'saveSettings', settings: { autoLockMinutes: 0, lockOnStartup: false, lockOnSystemLock: false, hideMode: MODE }, passcode: PASS });
  // the anchor: a window with unsaved typing that is never closed, hosting the control page
  const anchor = await worker.evaluate(async (u) => (await chrome.windows.create({ url: u, left: 20, top: 20, width: 500, height: 380 })).id, site('anchor'));
  await sleep(1500);
  await context.pages().find((p) => p.url().endsWith('?t=anchor')).fill('#d', 'unsaved');
  await worker.evaluate(async ([i, u]) => { await chrome.tabs.create({ windowId: i, url: u, active: false }); }, [anchor, `chrome-extension://${id}/ui/options.html`]);
  await sleep(1200);
  admin = context.pages().filter((p) => p.url().includes('options.html')).at(-1);
  const make = async (n, tabs) => worker.evaluate(async (urls) => (await chrome.windows.create({ url: urls, left: 120, top: 90, width: 760, height: 560 })).id, Array.from({ length: tabs }, (_, i) => site(`w${n}-${i}`)));
  const windows = async () => worker.evaluate(async () => (await chrome.windows.getAll({ windowTypes: ['normal'] })).length);
  const base = await windows();
  const t0 = Date.now();
  for (let round = 1; round <= ROUNDS && !crashed; round++) {
    await make(round, 3); await make(round + 100, 5);                           // two clean windows with several tabs
    await sleep(1800);
    const before = await windows();
    await send({ type: 'lock' });
    await sleep(MODE === 'close' ? 3500 : 2500);
    await send({ type: 'unlock', passcode: PASS });
    await sleep(MODE === 'close' ? 4500 : 2500);
    if (crashed) break;
    const after = await windows();
    // tidy: close the windows this round made (they are ours) so the next round starts the same
    const extra = await worker.evaluate(async (keep) => { const ws = await chrome.windows.getAll({ windowTypes: ['normal'] }); return ws.map((w) => w.id).filter((i) => i !== keep); }, anchor);
    for (const wid of extra) { await worker.evaluate((i) => chrome.windows.remove(i).catch(() => {}), wid); await sleep(900); }
    completed = round;
    console.log(`  round ${round}: windows before lock ${before}, after unlock ${after} (anchor + ${after - 1})`);
  }
  console.log(`\n${MODE}: ${completed} of ${ROUNDS} rounds completed in ${Math.round((Date.now() - t0) / 1000)}s; ${crashed ? `BRAVE CRASHED (${crashed})` : 'no crash'}`);
} catch (err) {
  console.log(`\n${MODE}: stopped after ${completed} rounds: ${crashed ? `BRAVE CRASHED (${crashed})` : String(err.message || err).split('\n')[0]}`);
} finally {
  try { brave.kill(); } catch { /* gone */ }
  await sleep(2000);
  server.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
}
