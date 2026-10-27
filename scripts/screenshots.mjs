// Regenerates the README screenshots from the running extension.
// Usage: CHROMIUM_PATH=/path/to/chromium node scripts/screenshots.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = (name) => path.join(root, 'docs/screenshots', name);

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<title>Quarterly planning</title><body style="font:16px system-ui;margin:48px;max-width:560px">
    <h1>Quarterly planning</h1><p>A page with some work in progress.</p><textarea rows="6" style="width:100%">Draft notes that must never be lost…</textarea></body>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const site = `http://127.0.0.1:${server.address().port}/`;

const profile = mkdtempSync(path.join(tmpdir(), 'latch-shots-'));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: false,
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
});

try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const ext = (p) => `chrome-extension://${id}/${p}`;

  const page = await context.newPage();
  await page.setViewportSize({ width: 760, height: 900 });
  await page.goto(ext('ui/options.html'));
  await page.fill('#newPasscode', 'correct horse battery');
  await page.fill('#repeatPasscode', 'correct horse battery');
  await page.click('#savePasscode');
  await page.waitForSelector('#passcodeMsg.ok');
  await page.reload();
  await page.screenshot({ path: out('settings.png'), fullPage: true });

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 310, height: 330 });
  await popup.goto(ext('ui/popup.html'));
  await popup.waitForFunction(() => document.getElementById('status').textContent.includes('Protecting'));
  await popup.locator('body').screenshot({ path: out('popup.png') });

  // Show the lock screen and a covered page without opening the real lock window.
  const sample = await context.newPage();
  await sample.setViewportSize({ width: 900, height: 560 });
  await sample.goto(site);
  await sample.screenshot({ path: out('page-unlocked.png') });
  await worker.evaluate(() => chrome.storage.local.set({ state: { locked: true, reason: '5 min of inactivity' } }));
  await sample.waitForFunction(() => document.documentElement.lastElementChild.getAttribute('popover') === 'manual');
  await sample.screenshot({ path: out('page-covered.png') });

  const lock = await context.newPage();
  await lock.setViewportSize({ width: 900, height: 560 });
  await lock.goto(ext('ui/lock.html'));
  await lock.waitForFunction(() => document.getElementById('reason').textContent !== '');
  await lock.screenshot({ path: out('lock.png') });
  await worker.evaluate(() => chrome.storage.local.set({ state: { locked: false } }));
  console.log('screenshots written to docs/screenshots');
} finally {
  await context.close();
  server.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
