// Window-state matrix: lock and unlock in every situation a real browser can be in, and check the basics each time:
// the page is covered, nothing is left behind, and every window comes back exactly as it was.
//   BRAVE=1 npm run test:windows        (real Brave, throwaway profile)
//   CHROMIUM_PATH=/path npm run test:windows
import { chromium } from 'playwright';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '../..');
const PASS = 'matrix pass 99';

const tone = (() => { const rate = 8000, n = rate, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * 3000), 44 + i * 2); return b; })();
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/tone.wav')) { res.writeHead(200, { 'content-type': 'audio/wav' }); return res.end(tone); }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(req.url.startsWith('/tall.html') ? `<title>${req.url}</title><div style="height:4000px">tall ${req.url}</div>` : req.url.startsWith('/tone.html') ? `<title>${req.url}</title><audio src="/tone.wav" autoplay loop></audio>` : `<title>${req.url}</title><textarea id="d"></textarea><p>${req.url}</p>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const site = (name) => `http://127.0.0.1:${server.address().port}/?t=${name}`;

const profile = mkdtempSync(path.join(tmpdir(), 'latch-win-'));
const flags = [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--autoplay-policy=no-user-gesture-required'];
let context, brave;
if (process.env.BRAVE) {
  brave = spawn('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', [`--user-data-dir=${profile}`, '--remote-debugging-port=9341', '--no-first-run', '--no-default-browser-check', '--disable-features=DisableLoadExtensionCommandLineSwitch', ...flags, 'about:blank'], { stdio: 'ignore' });
  brave.on('exit', (code, signal) => console.log(`  !! Brave exited: code=${code} signal=${signal}`));
  await new Promise((r) => setTimeout(r, 6000));
  context = (await chromium.connectOverCDP('http://127.0.0.1:9341')).contexts()[0];
} else {
  context = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROMIUM_PATH || undefined, headless: false, args: flags });
}


// The browser's own report of a window's state cannot be trusted (Brave on macOS reports "normal" for a window that really is
// minimized), so on macOS the test asks the operating system which of the browser's windows are actually on screen.
const ONSCREEN = path.join(tmpdir(), 'latch-onscreen-v2');
function onScreenTool() {
  if (process.platform !== 'darwin') return null;
  if (!existsSync(ONSCREEN)) {
    const src = `${ONSCREEN}.swift`;
    writeFileSync(src, 'import Cocoa\nlet pid = Int32(CommandLine.arguments[1])!\nlet list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]\nfor w in list where (w[kCGWindowOwnerPID as String] as? Int32) == pid && (w[kCGWindowLayer as String] as? Int) == 0 { let b = w[kCGWindowBounds as String] as! [String: Any]; print("\\(w[kCGWindowNumber as String] as! Int) \\(Int(b["Width"] as! Double))x\\(Int(b["Height"] as! Double))") }\n');
    execFileSync('swiftc', [src, '-o', ONSCREEN], { stdio: 'ignore' });
  }
  return ONSCREEN;
}
function browserPid() {
  if (brave) return brave.pid;
  const lines = execFileSync('pgrep', ['-fl', `user-data-dir=${profile}`], { encoding: 'utf8' }).trim().split('\n').filter((l) => !l.includes('--type='));
  return Number(lines[0].split(' ')[0]);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 10000) {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(100); }
  throw new Error(`timed out waiting for: ${what} (${last})`);
}

let passed = 0, failed = 0;
const results = [];
async function scenario(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  try { await fn(); passed++; results.push(`  ✓ ${name}`); console.log(`  ✓ ${name}`); }
  catch (err) { failed++; results.push(`  ✗ ${name}\n      ${String(err.message || err).split('\n')[0]}`); console.log(`  ✗ ${name}\n      ${String(err.message || err).split('\n')[0]}`); }
}

try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const ext = (p) => `chrome-extension://${id}/${p}`;
  let admin = (await context.pages().find((p) => p.url().includes('options.html'))) || await context.newPage();
  if (!admin.url().includes('options.html')) await admin.goto(ext('ui/options.html'));
  const send = (m) => admin.evaluate((msg) => chrome.runtime.sendMessage(msg), m);

  // set up: a passcode, and the inactivity timer off so nothing locks by itself
  assert.equal((await send({ type: 'setPasscode', passcode: PASS })).ok, true);
  assert.equal((await send({ type: 'saveSettings', settings: { autoLockMinutes: 0, lockOnStartup: false, lockOnSystemLock: false, hideMode: 'minimize' }, passcode: PASS })).ok, true);

  // ---- helpers in the browser's own terms ----
  const W = (fn, ...args) => worker.evaluate(([f, a]) => new Function('return ' + f)()(...a), [fn.toString(), args]);
  // Some browsers ignore a state passed at creation, so create the window, then set the state, like a person would.
  const create = async (opts) => {
    const { state, ...rest } = opts;
    const wid = await W(async (o) => (await chrome.windows.create({ ...o, state: 'normal' })).id, rest);
    if (state === 'maximized' || state === 'fullscreen') {
      await W((i, st) => chrome.windows.update(i, { state: st }), wid, state).catch(() => {});
      await until(async () => (await info(wid))?.state === state, `window to be ${state}`, 20000);
      await sleep(900);
    }
    return wid;
  };
  const info = (wid) => W(async (i) => { try { const w = await chrome.windows.get(i); return { state: w.state, left: w.left, top: w.top, width: w.width, height: w.height }; } catch { return null; } }, wid);
  const popups = () => W(async () => (await chrome.windows.getAll({ windowTypes: ['popup'] })).filter((w) => w.tabs !== undefined || true).length);
  const focus = (wid) => W((i) => chrome.windows.update(i, { focused: true }), wid);
  const focused = () => W(async () => (await chrome.windows.getLastFocused()).id);
  const pageFor = (name) => context.pages().find((p) => p.url().endsWith(`?t=${name}`));
  const coverUp = (page) => page.evaluate(() => Boolean(document.querySelector('[data-latch-cover]')));
  const lockedFlag = () => W(async () => (await chrome.storage.local.get('state')).state?.locked === true);
  const lock = async () => { assert.equal((await send({ type: 'lock' })).ok, true); await until(lockedFlag, 'locked flag'); await until(async () => (await popups()) >= 1, 'lock window'); await sleep(350); };
  const unlock = async () => { assert.equal((await send({ type: 'unlock', passcode: PASS })).ok, true); await until(async () => !(await lockedFlag()), 'unlocked flag'); await until(async () => (await popups()) === 0, 'lock window closed'); await sleep(300); };
  // macOS window ids of the browser's windows that are really on screen right now (macOS only; null elsewhere).
  const onScreenIds = () => {
    const tool = onScreenTool();
    if (!tool) return null;
    return new Map(execFileSync(tool, [String(browserPid())], { encoding: 'utf8' }).split('\n').filter(Boolean).map((l) => { const [id, size] = l.split(' '); const [w, h] = size.split('x').map(Number); return [Number(id), { w, h }]; }));
  };
  // Create a window and learn its macOS id by comparing the on-screen list before and after.
  const createTracked = async (opts) => {
    const before = onScreenIds();
    const wid = await create(opts);
    if (!before) return { wid, mac: null };
    let mac = null;
    await until(async () => { const now = onScreenIds(); const fresh = [...now].filter(([id]) => !before.has(id)).sort((a, b) => b[1].w * b[1].h - a[1].w * a[1].h); if (fresh.length) { mac = fresh[0][0]; return true; } return false; }, 'the new window to appear in the on-screen list', 8000);
    return { wid, mac };
  };
  // A minimized window stays in macOS's list as a small Dock thumbnail, so "hidden" means shrunk to a thumbnail, and "back" means
  // restored to its original size.
  const sizeOf = (mac) => (mac == null ? null : onScreenIds().get(mac) ?? null);
  // With Stage Manager on, a browser that is not the active app has its windows shown as small side-strip thumbnails, which would
  // look like "minimized". Make the test browser the active app before looking at sizes.
  const activate = () => { try { execFileSync('osascript', ['-e', `tell application "System Events" to set frontmost of (first process whose unix id is ${browserPid()}) to true`], { stdio: ['ignore', 'ignore', 'pipe'] }); } catch (e) { if (!activate.warned) { activate.warned = true; console.log('   (could not bring the test browser to the front: ' + String(e.stderr || e.message).trim().slice(0, 160) + ')'); } } };
  // A new window is listed while it is still opening, at a small size, so wait until the size stops changing.
  const settledSize = async (mac) => {
    activate();
    let last = null;
    for (let i = 0; i < 40; i++) {
      const sz = sizeOf(mac);
      if (sz && last && sz.w === last.w && sz.h === last.h && sz.w > 300) return sz;
      last = sz; await sleep(250);
    }
    return sizeOf(mac);
  };
  const isFull = (mac, full) => { const sz = sizeOf(mac); return sz != null && Math.abs(sz.w - full.w) <= 3 && Math.abs(sz.h - full.h) <= 3; };
  const isMinimized = (mac, full) => { const sz = sizeOf(mac); return sz === null || sz.w * sz.h < full.w * full.h * 0.3; };
  const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;
  const sameBounds = (a, b) => near(a.left, b.left) && near(a.top, b.top) && near(a.width, b.width) && near(a.height, b.height);
  const closeWin = async (wid) => { const was = (await info(wid))?.state; await W((i) => chrome.windows.remove(i).catch(() => {}), wid); await sleep(was === 'fullscreen' ? 2200 : 300); };   // a closing full-screen window animates out


  // A permanent anchor window, with unsaved typing so complete hiding never closes it. It hosts the control page,
  // and it keeps the browser alive: a browser quits when its last window closes, which is normal and not what is tested here.
  const anchorId = await W(async (url) => (await chrome.windows.create({ url, state: 'normal', left: 30, top: 30, width: 600, height: 420 })).id, site('anchor'));
  await until(() => context.pages().find((p) => p.url().endsWith('?t=anchor')), 'the anchor page');
  await context.pages().find((p) => p.url().endsWith('?t=anchor')).fill('#d', 'unsaved, so this window is never closed');
  await W((i, url) => chrome.tabs.create({ windowId: i, url, active: false }), anchorId, ext('ui/options.html'));
  await until(() => context.pages().filter((p) => p.url().includes('options.html')).length >= 2, 'the control page in the anchor');
  admin = context.pages().filter((p) => p.url().includes('options.html')).at(-1);

  console.log('\nWindow matrix');

  await scenario('the lock window covers the whole screen, whatever the browser did with the requested state', async () => {
    const w = await create({ url: site('screen'), state: 'normal', left: 120, top: 120, width: 700, height: 500 });
    await until(() => pageFor('screen'), 'page'); await sleep(400);
    await lock();
    await sleep(1200);                                            // the lock page reports the screen, then the window resizes
    const screenSize = await admin.evaluate(() => ({ w: screen.availWidth, h: screen.availHeight }));
    const lockWin = await W(async () => { const [p] = await chrome.windows.getAll({ windowTypes: ['popup'] }); return { state: p.state, width: p.width, height: p.height }; });
    assert.ok(lockWin.state === 'maximized' || lockWin.state === 'fullscreen' || (lockWin.width >= screenSize.w - 24 && lockWin.height >= screenSize.h - 60), `lock window ${JSON.stringify(lockWin)} vs screen ${JSON.stringify(screenSize)}`);
    await unlock();
    await closeWin(w);
  });

  await scenario('normal window: covered while locked, same bounds and state after', async () => {
    const { wid: w, mac } = await createTracked({ url: site('normal'), state: 'normal', left: 80, top: 80, width: 901, height: 641 });
    await until(() => pageFor('normal'), 'page'); await sleep(500);
    const before = await info(w);
    await focus(w); const f = await focused();
    const full = mac != null ? await settledSize(mac) : null;
    if (mac != null) assert.ok(full && full.w > 300, `the window is on screen at full size before locking (mac=${mac} size=${JSON.stringify(full)} locked=${await lockedFlag()} windows=${JSON.stringify(await W(async () => (await chrome.windows.getAll()).map((x) => [x.id, x.type, x.state, x.width, x.height, x.focused])))})`);
    await lock();
    assert.ok(await coverUp(pageFor('normal')), 'page is covered');
    if (mac != null) await until(async () => isMinimized(mac, full), 'the window to really be minimized (shrunk to its Dock thumbnail), as macOS sees it', 6000);
    await unlock();
    if (mac != null) await until(async () => isFull(mac, full), 'the window to really be back at its full size after unlocking, as macOS sees it', 8000);
    const after = await info(w);
    assert.equal(after.state, before.state, 'state');
    assert.ok(sameBounds(before, after), `bounds ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    assert.equal(await focused(), f, 'focus returns to the same window');
    assert.ok(!(await coverUp(pageFor('normal'))), 'cover removed');
    await closeWin(w);
  });

  await scenario('maximized window: stays maximized', async () => {
    const w = await create({ url: site('max'), state: 'maximized' });
    await until(() => pageFor('max'), 'page'); await sleep(500);
    await lock();
    assert.ok(await coverUp(pageFor('max')));
    await unlock();
    assert.equal((await info(w)).state, 'maximized');
    await closeWin(w);
  });

  await scenario('half-screen window (left half, then right half): exact bounds restored', async () => {
    for (const [name, left] of [['half-left', 0], ['half-right', 720]]) {
      const { wid: w, mac } = await createTracked({ url: site(name), state: 'normal', left, top: 40, width: 723, height: 761 });
      await until(() => pageFor(name), 'page'); await sleep(500);
      const hfull = mac != null ? await settledSize(mac) : null;
      const before = await info(w);
      await lock();
      assert.ok(await coverUp(pageFor(name)), `${name} covered`);
      if (mac != null) await until(async () => isMinimized(mac, hfull), `${name} to really be minimized`, 6000);
      await unlock();
      if (mac != null) await until(async () => isFull(mac, hfull), `${name} to really be back at full size`, 8000);
      const after = await info(w);
      assert.ok(sameBounds(before, after), `${name}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
      await closeWin(w);
    }
  });

  await scenario('full-screen window on a normal page: taken out of full screen while locked, covered, back in full screen after', async () => {
    const w = await create({ url: site('fs'), state: 'fullscreen' });
    await until(async () => (await info(w))?.state === 'fullscreen', 'fullscreen', 20000); await until(() => pageFor('fs'), 'page'); await sleep(600);
    await lock();
    assert.ok(await coverUp(pageFor('fs')), 'covered');
    assert.notEqual((await info(w)).state, 'fullscreen', 'a full-screen window is not left showing its tabs and page');
    await unlock();
    await until(async () => (await info(w)).state === 'fullscreen', 'back in full screen after unlocking', 20000);
    assert.ok(!(await coverUp(pageFor('fs'))));
    await closeWin(w);
  });

  await scenario('full-screen window on an internal page (a page nothing can draw on): also hidden, and restored', async () => {
    const w = await create({ url: 'chrome://version', state: 'fullscreen' });
    await until(async () => (await info(w))?.state === 'fullscreen', 'fullscreen', 20000); await sleep(600);
    await lock();
    assert.notEqual((await info(w)).state, 'fullscreen', 'an exposed window is not left on screen');
    await unlock();
    await until(async () => (await info(w)).state === 'fullscreen', 'back to full screen');
    await closeWin(w);
  });

  await scenario('window the user had minimized stays minimized (or unchanged) after lock and unlock', async () => {
    const w = await create({ url: site('mini'), state: 'normal', left: 100, top: 100, width: 700, height: 500 });
    await until(() => pageFor('mini'), 'page'); await sleep(400);
    await W((i) => chrome.windows.update(i, { state: 'minimized' }), w); await sleep(400);
    const before = (await info(w)).state;
    await lock(); await unlock();
    assert.equal((await info(w)).state, before, 'a window you minimized is not popped back open');
    await closeWin(w);
  });

  await scenario('several windows at once (normal, maximized, full screen): each restored, focus returns to the one in use', async () => {
    const a = await create({ url: site('multi-a'), state: 'normal', left: 60, top: 60, width: 800, height: 600 });
    const b = await create({ url: site('multi-b'), state: 'maximized' });
    const c = await create({ url: site('multi-c'), state: 'fullscreen' });
    await until(async () => (await info(c))?.state === 'fullscreen', 'fullscreen'); await sleep(700);
    await focus(a); await sleep(1500);                           // come back to the desktop Space before measuring
    const beforeA = await info(a); const f = await focused();
    await lock();
    for (const n of ['multi-a', 'multi-b', 'multi-c']) assert.ok(await coverUp(pageFor(n)), `${n} covered`);
    assert.notEqual((await info(c)).state, 'fullscreen', 'the full-screen window is hidden too');
    await unlock();
    const afterA = await info(a);
    assert.ok(sameBounds(beforeA, afterA), `a restored: ${JSON.stringify(beforeA)} -> ${JSON.stringify(afterA)}`);
    assert.equal((await info(b)).state, 'maximized');
    await until(async () => (await info(c)).state === 'fullscreen', 'c back in full screen', 20000);
    assert.equal(await focused(), f, 'focus returns to the window you were using');
    for (const wid of [a, b, c]) await closeWin(wid);
  });

  await scenario('several ordinary windows: each one comes back, not only the one that gets focus', async () => {
    // Which window gets focus after unlocking is not the point here: the others must be really un-minimized, as macOS sees it.
    const a = await createTracked({ url: site('ord-a'), state: 'normal', left: 40, top: 60, width: 640, height: 520 });
    const b = await createTracked({ url: site('ord-b'), state: 'normal', left: 300, top: 120, width: 700, height: 480 });
    const m = await createTracked({ url: site('ord-m'), state: 'maximized' });
    await until(() => pageFor('ord-m'), 'page'); await sleep(500);
    await focus(a.wid); await sleep(500);
    const wins = [a, b, m];
    const sizes = new Map();
    for (const x of wins) sizes.set(x, x.mac != null ? await settledSize(x.mac) : null);
    await lock();
    if (a.mac != null) for (const x of wins) await until(async () => isMinimized(x.mac, sizes.get(x)), 'every window to really be minimized', 6000);
    await unlock();
    if (a.mac != null) for (const x of wins) await until(async () => isFull(x.mac, sizes.get(x)), `window ${x.wid} to really be back at full size`, 8000);
    for (const x of wins) await closeWin(x.wid);
  });

  await scenario('a window with several tabs: every tab is covered, not only the visible one', async () => {
    const w = await create({ url: [site('tabs-1'), site('tabs-2'), site('tabs-3')], state: 'normal', left: 100, top: 100, width: 800, height: 600 });
    await until(() => pageFor('tabs-1') && pageFor('tabs-2') && pageFor('tabs-3'), 'pages'); await sleep(700);
    await lock();
    for (const n of ['tabs-1', 'tabs-2', 'tabs-3']) assert.ok(await coverUp(pageFor(n)), `${n} covered`);
    await unlock();
    for (const n of ['tabs-1', 'tabs-2', 'tabs-3']) assert.ok(!(await coverUp(pageFor(n))), `${n} uncovered`);
    await closeWin(w);
  });

  await scenario('a tab opened while locked is covered too', async () => {
    const w = await create({ url: site('late-base'), state: 'normal', left: 100, top: 100, width: 800, height: 600 });
    await until(() => pageFor('late-base'), 'page'); await sleep(400);
    await lock();
    await W((i, url) => chrome.tabs.create({ windowId: i, url }), w, site('late-new'));
    await until(() => pageFor('late-new'), 'the new tab'); 
    await until(async () => coverUp(pageFor('late-new')), 'the new tab to be covered');
    await unlock();
    assert.ok(!(await coverUp(pageFor('late-new'))));
    await closeWin(w);
  });

  await scenario('a window opened while locked is handled; unlock still restores the others', async () => {
    const a = await create({ url: site('open-a'), state: 'normal', left: 100, top: 100, width: 800, height: 600 });
    await until(() => pageFor('open-a'), 'page'); await sleep(400);
    const before = await info(a);
    await lock();
    const b = await create({ url: site('open-b'), state: 'normal', left: 200, top: 200, width: 700, height: 500 });
    await until(() => pageFor('open-b'), 'page'); await sleep(500);
    assert.ok(await coverUp(pageFor('open-b')), 'the new window is covered');
    await unlock();
    assert.ok(sameBounds(before, await info(a)));
    await closeWin(a); await closeWin(b);
  });

  await scenario('a window closed while locked does not break unlocking', async () => {
    const a = await create({ url: site('close-a'), state: 'normal', left: 100, top: 100, width: 800, height: 600 });
    const b = await create({ url: site('close-b'), state: 'normal', left: 160, top: 160, width: 800, height: 600 });
    await until(() => pageFor('close-a') && pageFor('close-b'), 'pages'); await sleep(500);
    const before = await info(a);
    await lock();
    await closeWin(b);
    await unlock();
    assert.ok(sameBounds(before, await info(a)));
    await closeWin(a);
  });

  await scenario('locking twice, and unlocking twice, is harmless', async () => {
    const a = await create({ url: site('twice'), state: 'normal', left: 100, top: 100, width: 800, height: 600 });
    await until(() => pageFor('twice'), 'page'); await sleep(400);
    const before = await info(a);
    await lock(); await send({ type: 'lock' }); await sleep(300);
    assert.equal(await popups(), 1, 'one lock window, not two');
    await unlock();
    const again = await send({ type: 'unlock', passcode: PASS });
    assert.ok(again.ok, 'a second unlock does not error');
    assert.equal(await popups(), 0);
    assert.ok(sameBounds(before, await info(a)));
    await closeWin(a);
  });

  await scenario('bringing a locked window forward (Dock, Mission Control, Cmd+Tab) puts the lock window straight back in front', async () => {
    const a = await create({ url: site('restore-a'), state: 'normal', left: 100, top: 100, width: 800, height: 600 });
    const b = await create({ url: site('restore-b'), state: 'normal', left: 160, top: 160, width: 800, height: 600 });
    await until(() => pageFor('restore-a') && pageFor('restore-b'), 'pages'); await sleep(500);
    await lock();
    const lockId = await W(async () => (await chrome.windows.getAll({ windowTypes: ['popup'] }))[0].id);
    const times = [];
    for (const target of [a, b, a]) {
      const t0 = Date.now();
      await W((i) => chrome.windows.update(i, { state: 'normal', focused: true }), target);        // what clicking it in the Dock or Mission Control does
      await until(async () => (await focused()) === lockId, 'the lock window to take focus back', 6000);
      times.push(Date.now() - t0);
      assert.ok(await coverUp(pageFor(target === a ? 'restore-a' : 'restore-b')), 'and the page of that window is covered');
    }
    console.log(`      (lock window back in front after ${times.join(' ms, ')} ms)`);
    assert.ok(Math.max(...times) < 1200, `the lock window must take focus back quickly, took ${times.join(', ')} ms`);
    assert.ok(await lockedFlag(), 'still locked');
    await unlock();
    await closeWin(a); await closeWin(b);
  });

  await scenario('even with 30 tabs open, a locked window brought forward is pushed back within a second', async () => {
    const many = await create({ url: Array.from({ length: 30 }, (_, i) => site(`many-${i}`)), state: 'normal', left: 100, top: 100, width: 800, height: 600 });
    await until(() => pageFor('many-29'), 'the last page', 20000); await sleep(1500);
    const other = await create({ url: site('many-other'), state: 'normal', left: 160, top: 160, width: 800, height: 600 });
    await until(() => pageFor('many-other'), 'page'); await sleep(500);
    await lock();
    await sleep(2500);
    const lockId = await W(async () => (await chrome.windows.getAll({ windowTypes: ['popup'] }))[0].id);
    const times = [];
    for (const target of [many, other, many]) {
      const t0 = Date.now();
      await W((i) => chrome.windows.update(i, { state: 'normal', focused: true }), target);
      await until(async () => (await focused()) === lockId, 'the lock window to take focus back', 8000);
      times.push(Date.now() - t0);
      await sleep(300);
    }
    console.log(`      (30 tabs: lock window back in front after ${times.join(' ms, ')} ms)`);
    assert.ok(Math.max(...times) < 1000, `too slow with many tabs: ${times.join(', ')} ms`);
    for (let i = 0; i < 30; i += 7) assert.ok(await coverUp(pageFor(`many-${i}`)), `many-${i} covered`);
    await unlock();
    await closeWin(many); await closeWin(other);
  });

  await scenario('closing the lock window does not unlock, and it returns', async () => {
    const a = await create({ url: site('closelock'), state: 'normal', left: 100, top: 100, width: 800, height: 600 });
    await until(() => pageFor('closelock'), 'page'); await sleep(400);
    await lock();
    const popId = await W(async () => (await chrome.windows.getAll({ windowTypes: ['popup'] }))[0].id);
    await W((i) => chrome.windows.remove(i), popId);
    await until(async () => (await popups()) >= 1, 'the lock window to come back');
    assert.ok(await lockedFlag(), 'still locked');
    assert.ok(await coverUp(pageFor('closelock')), 'still covered');
    await unlock();
    await closeWin(a);
  });

  if (process.platform === 'darwin') {
    const strictWorks = (await send({ type: 'probeStrict' })).ok;
    console.log(`  (hiding windows completely: ${strictWorks ? 'this browser can do it' : 'refused by the browser check'})`);
    const tallUrl = (name) => `${site(name).split('?')[0]}tall.html?t=${name}`;
    const setMode = (mode) => send({ type: 'saveSettings', settings: { hideMode: mode }, passcode: PASS });

    if (strictWorks) await scenario('complete hiding: windows vanish while locked and come back exactly (size, tab order, pinned, group, active tab, scroll)', async () => {
      assert.equal((await setMode('close')).ok, true);
      const target = await create({ url: [site('pin-a'), tallUrl('grp-1'), tallUrl('grp-2'), site('plain-3'), tallUrl('active-4')], state: 'normal', left: 130, top: 110, width: 820, height: 620 });
      await until(() => pageFor('pin-a') && pageFor('grp-1') && pageFor('grp-2') && pageFor('plain-3') && pageFor('active-4'), 'tabs'); await sleep(900);
      const ids = await W(async (w) => (await chrome.tabs.query({ windowId: w })).sort((a, b) => a.index - b.index).map((t) => t.id), target);
      await W(async (a) => { await chrome.tabs.update(a[0], { pinned: true }); const g = await chrome.tabs.group({ tabIds: [a[1], a[2]] }); await chrome.tabGroups.update(g, { title: 'Work', color: 'blue' }); await chrome.tabs.update(a[4], { active: true }); }, ids);
      await sleep(400);
      await pageFor('active-4').evaluate(() => window.scrollTo(0, 1200)); await sleep(300);
      const before = await info(target);
      await focus(target); await sleep(400);
      await lock();
      await until(async () => (await info(target)) === null, 'the window to disappear', 10000);
      assert.equal(await W(async () => (await chrome.storage.local.get('strictRestore')).strictRestore?.length || 0), 1, 'the record is in persistent storage, so quitting while locked loses nothing');
      for (const n of ['pin-a', 'grp-1', 'grp-2', 'plain-3', 'active-4']) assert.ok(!pageFor(n), `${n} is gone from the screen`);
      assert.ok(await info(anchorId), 'the window with unsaved typing stayed open');
      await unlock();
      await until(() => pageFor('pin-a') && pageFor('grp-1') && pageFor('grp-2') && pageFor('plain-3') && pageFor('active-4'), 'every tab to come back', 20000);
      const back = await W(async () => { const ws = await chrome.windows.getAll({ populate: true }); const w = ws.find((x) => x.tabs.some((t) => (t.url || '').includes('pin-a'))); const groups = await chrome.tabGroups.query({ windowId: w.id }); return { id: w.id, left: w.left, top: w.top, width: w.width, height: w.height, tabs: w.tabs.sort((a, b) => a.index - b.index).map((t) => ({ u: (t.url || '').split('t=')[1], pinned: t.pinned, active: t.active, g: t.groupId })), groups }; });
      assert.deepEqual(back.tabs.map((t) => t.u), ['pin-a', 'grp-1', 'grp-2', 'plain-3', 'active-4'], 'same order');
      assert.equal(back.tabs[0].pinned, true, 'the pinned tab is pinned');
      assert.equal(back.tabs[1].g, back.tabs[2].g, 'the two grouped tabs are grouped together'); assert.notEqual(back.tabs[1].g, -1);
      assert.equal(back.tabs[3].g, -1, 'and the others are not');
      assert.equal(back.groups[0].title, 'Work', 'the group keeps its name'); assert.equal(back.groups[0].color, 'blue', 'and colour');
      assert.equal(back.tabs[4].active, true, 'the active tab is active');
      assert.ok(near(back.width, before.width, 6) && near(back.height, before.height, 40), `size restored: ${JSON.stringify(before)} -> ${JSON.stringify(back)}`);
      await until(async () => (await pageFor('active-4').evaluate(() => window.scrollY)) > 1000, 'the scroll position to come back', 8000);
      assert.equal(await W(async () => (await chrome.storage.local.get('strictRestore')).strictRestore?.length || 0), 0, 'the record is cleared');
      await W((i) => chrome.windows.remove(i).catch(() => {}), back.id); await sleep(300);
      await setMode('minimize');
    });

    if (strictWorks) await scenario('complete hiding: never closes a window with sound, or one showing a page that cannot be reopened', async () => {
      assert.equal((await setMode('close')).ok, true);
      const audio = await create({ url: `${site('x').split('?')[0]}tone.html?t=audio`, state: 'normal', left: 100, top: 100, width: 700, height: 500 });
      const internal = await create({ url: 'chrome://version', state: 'normal', left: 140, top: 140, width: 700, height: 500 });
      await sleep(2500);
      const audible = await W(async (i) => (await chrome.tabs.query({ windowId: i, audible: true })).length, audio);
      assert.ok(audible > 0, 'the test tone must really be playing, or this check proves nothing');
      await lock(); await sleep(2500);
      assert.ok(await info(audio), 'a window with a playing tab stays');
      assert.ok(await info(internal), 'a window on an internal page stays (it cannot be recreated)');
      await unlock();
      await closeWin(audio); await closeWin(internal); await setMode('minimize');
    });

    if (strictWorks) await scenario('complete hiding: a window that would not close is minimized, never duplicated', async () => {
      // everything opened in an earlier scenario is gone; one lock and unlock leaves exactly the windows that were there
      const before = await W(async () => (await chrome.windows.getAll({ windowTypes: ['normal'] })).length);
      assert.equal((await setMode('close')).ok, true);
      await lock(); await sleep(1500); await unlock(); await sleep(1500);
      const after = await W(async () => (await chrome.windows.getAll({ windowTypes: ['normal'] })).length);
      assert.equal(after, before, `the same number of windows before and after (${before} -> ${after})`);
      await setMode('minimize');
    });
  }

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed) process.exitCode = 1;
} catch (err) {
  console.error('\nSETUP FAILED:', err);
  process.exitCode = 1;
} finally {
  if (brave) { const exited = new Promise((r) => brave.once('exit', r)); brave.kill(); await exited; } else { await context.close().catch(() => {}); }
  server.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
