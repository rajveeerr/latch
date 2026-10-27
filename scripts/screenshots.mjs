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
  const shot = async (page, name, opts = {}) => {
    if (opts.fullPage) {          // size the viewport to the page so nothing is cut off
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width: page.viewportSize().width, height });
      opts = { ...opts, fullPage: false };
    }
    return page.screenshot({ path: out(name), ...opts });
  };
  // A device passkey stand-in, attached before the page loads so Touch ID shows as available.
  const withTouchId = async (page) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: false, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  };
  const open = async (file, size, scheme = 'light', touch = false, lockStyle = null) => {
    const page = await context.newPage();
    if (lockStyle) await page.addInitScript((value) => localStorage.setItem('lockStyle', value), lockStyle);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.setViewportSize(size);
    if (touch) await withTouchId(page);
    await page.goto(ext(file));
    return page;
  };
  const PASS = 'correct horse battery';

  // First run: Aegis walks you through it.
  const ob = await open('ui/options.html', { width: 1000, height: 760 });
  await ob.waitForSelector('#onboarding:not([hidden])');
  await ob.waitForTimeout(500);
  await shot(ob, 'onboarding-welcome.png');
  await ob.click('#obStart');
  await ob.fill('#newPasscode', PASS);
  await ob.fill('#repeatPasscode', PASS);
  await ob.waitForSelector('.aegis[data-state="typing"]');
  await shot(ob, 'onboarding-passcode.png');
  await ob.click('#savePasscode');
  await ob.waitForSelector('#recoverySheet:not([hidden])');
  await shot(ob, 'onboarding-recovery.png');
  await ob.check('#recoverySaved');
  await ob.click('#recoveryDone');
  await ob.waitForSelector('#obPrivate:not([hidden])');
  await shot(ob, 'onboarding-private.png');
  await ob.click('#obSkip');
  await ob.close();

  // Settings, light and dark.
  for (const scheme of ['light', 'dark']) {
    const page = await open('ui/options.html', { width: 1120, height: 900 }, scheme, true);
    await page.waitForFunction(() => document.getElementById('statusTitle').textContent.includes('Protecting'));
    if (scheme === 'light') {
      await page.click('#touchSetup');
      await page.fill('#authPasscode', PASS);
      await page.click('#save');
      await page.waitForSelector('#touchRemove:not([hidden])');
      await page.waitForTimeout(3000);                      // let the toast fade
    }
    await page.waitForTimeout(400);
    await shot(page, scheme === 'light' ? 'settings-light.png' : 'settings-dark.png', { fullPage: true });
    if (scheme === 'light') {
      await page.setViewportSize({ width: 1120, height: 900 });
      await page.fill('#autoLockMinutes', '0');
      await page.press('#autoLockMinutes', 'Tab');
      await page.waitForSelector('#authRow:not([hidden])');
      await page.waitForTimeout(400);
      await shot(page, 'settings-confirm.png');
      await page.click('#cancelChange');
    }
    await page.close();
  }

  // Popup, light and dark, plus the pause panel.
  for (const scheme of ['light', 'dark']) {
    const popup = await open('ui/popup.html', { width: 320, height: 330 }, scheme);
    await popup.waitForFunction(() => document.getElementById('status').textContent.includes('Protecting'));
    await popup.waitForTimeout(300);
    await shot(popup, scheme === 'light' ? 'popup-light.png' : 'popup.png', { fullPage: true });
    if (scheme === 'dark') { await popup.click('#pauseToggle'); await shot(popup, 'popup-pause.png', { fullPage: true }); }
    await popup.close();
  }

  // A page, then the same page while locked. (State is set directly so no real lock window opens.)
  for (const scheme of ['light', 'dark']) {
    const sample = await context.newPage();
    await sample.emulateMedia({ colorScheme: scheme });
    await sample.setViewportSize({ width: 900, height: 560 });
    await sample.goto(site);
    if (scheme === 'light') await shot(sample, 'page-unlocked.png');
    await worker.evaluate(() => chrome.storage.local.set({ state: { locked: true, reason: '5 min of inactivity' } }));
    await sample.waitForFunction(() => document.documentElement.lastElementChild.getAttribute('popover') === 'manual');
    await shot(sample, scheme === 'light' ? 'page-covered.png' : 'page-covered-dark.png');
    await worker.evaluate(() => chrome.storage.local.set({ state: { locked: false } }));
    await sample.close();
  }

  // The lock screen: both appearances, and the lock reacting to what you do.
  await worker.evaluate(() => chrome.storage.local.set({ state: { locked: true, reason: '5 min of inactivity' } }));
  for (const scheme of ['light', 'dark']) {
    const lock = await open('ui/lock.html', { width: 1440, height: 900 }, scheme, true);
    await lock.waitForFunction(() => document.getElementById('reason').textContent.includes('inactivity'));
    await lock.waitForTimeout(400);
    await shot(lock, scheme === 'light' ? 'lock-light.png' : 'lock-dark.png');
    if (scheme === 'light') {
      await lock.fill('#passcode', 'not it');
      await lock.waitForTimeout(500);
      await shot(lock, 'lock-typing.png');
      await lock.click('#unlock');
      await lock.waitForSelector('#dialVisual.wrong');
      await lock.waitForTimeout(200);
      await shot(lock, 'lock-wrong.png');
      await lock.click('#forgot');
      await shot(lock, 'lock-recover.png');
    }
    await lock.close();
  }
  await worker.evaluate(() => chrome.storage.local.set({ state: { locked: false } }));

  // "Private windows only" before Latch is allowed in private windows: the overview and the popup say so.
  const scoped = await context.newPage();
  await scoped.goto(ext('ui/options.html'));
  await scoped.evaluate(async (pass) => chrome.runtime.sendMessage({ type: 'saveSettings', settings: { ...(await chrome.runtime.sendMessage({ type: 'getSettings' })).settings, scope: 'private' }, passcode: pass }), PASS);
  await scoped.close();
  const warn = await open('ui/options.html', { width: 1120, height: 420 });
  await warn.waitForFunction(() => document.getElementById('statusTitle').textContent.includes('cannot be locked'));
  await shot(warn, 'private-warning.png', { clip: { x: 230, y: 0, width: 780, height: 320 } });
  await warn.close();
  const warnPopup = await open('ui/popup.html', { width: 320, height: 330 });
  await warnPopup.waitForFunction(() => document.getElementById('status').textContent.includes('can’t be locked'));
  await shot(warnPopup, 'popup-private-warning.png', { fullPage: true });
  await warnPopup.close();
  console.log('screenshots written to docs/screenshots');
} finally {
  await context.close();
  server.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
