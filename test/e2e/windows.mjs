// Window-state matrix: lock and unlock in every situation a real browser can be in, and check the basics each time:
// the page is covered, nothing is left behind, and every window comes back exactly as it was.
//   BRAVE=1 npm run test:windows        (real Brave, throwaway profile)
//   CHROMIUM_PATH=/path npm run test:windows
import { chromium } from 'playwright';
import http from 'node:http';
import { spawn } from 'node:child_process';
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
  res.end(req.url.startsWith('/tone.html') ? `<title>${req.url}</title><audio src="/tone.wav" autoplay loop></audio>` : `<title>${req.url}</title><textarea id="d"></textarea><p>${req.url}</p>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const site = (name) => `http://127.0.0.1:${server.address().port}/?t=${name}`;

const profile = mkdtempSync(path.join(tmpdir(), 'latch-win-'));
const flags = [`--disable-extensions-except=${root}`, `--load-extension=${root}`];
let context, brave;
if (process.env.BRAVE) {
  brave = spawn('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', [`--user-data-dir=${profile}`, '--remote-debugging-port=9341', '--no-first-run', '--no-default-browser-check', '--disable-features=DisableLoadExtensionCommandLineSwitch', ...flags, 'about:blank'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 6000));
  context = (await chromium.connectOverCDP('http://127.0.0.1:9341')).contexts()[0];
} else {
  context = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROMIUM_PATH || undefined, headless: false, args: flags });
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
  assert.equal((await send({ type: 'saveSettings', settings: { autoLockMinutes: 0, lockOnStartup: false, lockOnSystemLock: false }, passcode: PASS })).ok, true);

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
  const pageFor = (name) => context.pages().find((p) => p.url() === site(name));
  const coverUp = (page) => page.evaluate(() => Boolean(document.querySelector('[data-latch-cover]')));
  const lockedFlag = () => W(async () => (await chrome.storage.local.get('state')).state?.locked === true);
  const lock = async () => { assert.equal((await send({ type: 'lock' })).ok, true); await until(lockedFlag, 'locked flag'); await until(async () => (await popups()) >= 1, 'lock window'); await sleep(350); };
  const unlock = async () => { assert.equal((await send({ type: 'unlock', passcode: PASS })).ok, true); await until(async () => !(await lockedFlag()), 'unlocked flag'); await until(async () => (await popups()) === 0, 'lock window closed'); await sleep(300); };
  const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;
  const sameBounds = (a, b) => near(a.left, b.left) && near(a.top, b.top) && near(a.width, b.width) && near(a.height, b.height);
  const closeWin = async (wid) => { const was = (await info(wid))?.state; await W((i) => chrome.windows.remove(i).catch(() => {}), wid); await sleep(was === 'fullscreen' ? 2200 : 300); };   // a closing full-screen window animates out

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
    const w = await create({ url: site('normal'), state: 'normal', left: 80, top: 80, width: 900, height: 640 });
    await until(() => pageFor('normal'), 'page'); await sleep(500);
    const before = await info(w);
    await focus(w); const f = await focused();
    await lock();
    assert.ok(await coverUp(pageFor('normal')), 'page is covered');
    await unlock();
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
      const w = await create({ url: site(name), state: 'normal', left, top: 40, width: 720, height: 760 });
      await until(() => pageFor(name), 'page'); await sleep(500);
      const before = await info(w);
      await lock();
      assert.ok(await coverUp(pageFor(name)), `${name} covered`);
      await unlock();
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
    for (const target of [a, b, a]) {
      await W((i) => chrome.windows.update(i, { state: 'normal', focused: true }), target);        // what clicking it in the Dock or Mission Control does
      await until(async () => (await focused()) === lockId, 'the lock window to take focus back', 6000);
      assert.ok(await coverUp(pageFor(target === a ? 'restore-a' : 'restore-b')), 'and the page of that window is covered');
    }
    assert.ok(await lockedFlag(), 'still locked');
    await unlock();
    await closeWin(a); await closeWin(b);
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
    console.log(`  (this browser ${strictWorks ? 'can' : 'cannot'} close multi-tab windows without asking: strict hiding is ${strictWorks ? 'available' : 'refused, as it should be'})`);
    if (!strictWorks) await scenario('strict hiding is refused where the browser would keep multi-tab windows open', async () => { assert.equal((await send({ type: 'probeStrict' })).ok, false); });
    if (strictWorks) await scenario('strict hiding: a clean window is closed while locked and reopened on unlock; a window with unsaved typing is never closed', async () => {
      assert.equal((await send({ type: 'saveSettings', settings: { hideMode: 'close' }, passcode: PASS })).ok, true);
      const clean = await create({ url: [site('strict-clean-1'), site('strict-clean-2')], state: 'normal', left: 100, top: 100, width: 800, height: 600 });
      const dirty = await create({ url: site('strict-dirty'), state: 'normal', left: 140, top: 140, width: 800, height: 600 });
      await until(() => pageFor('strict-clean-1') && pageFor('strict-clean-2') && pageFor('strict-dirty'), 'pages'); await sleep(600);
      await pageFor('strict-dirty').fill('#d', 'a half-typed draft that must survive');
      // the control page of this test must live in the window that strict hiding will never close
      await W((i, url) => chrome.tabs.create({ windowId: i, url, active: false }), dirty, ext('ui/options.html'));
      await until(() => context.pages().filter((p) => p.url().includes('options.html')).length >= 2, 'a second control page');
      admin = context.pages().filter((p) => p.url().includes('options.html')).at(-1);
      await focus(clean); await sleep(500);
      await lock();
      await until(async () => (await info(clean)) === null, 'the clean window to be closed', 8000).catch(() => {});
      const events = await W(async () => ((await chrome.storage.local.get('activity')).activity || []).slice(-6).map((e) => `${e.type}:${e.detail}`).join(' | '));
      const dump = await W(async () => JSON.stringify({ wins: (await chrome.windows.getAll({ populate: true })).map((w) => ({ id: w.id, type: w.type, state: w.state, tabs: w.tabs.map((t) => (t.url || '').slice(-22)) })), saved: ((await chrome.storage.local.get('strictRestore')).strictRestore || []).map((x) => ({ sid: !!x.sessionId, n: x.tabs.length })) }));
      assert.equal(await info(clean), null, `the clean window is gone while locked (clean=${clean}; activity: ${events}; ${dump})`);
      assert.ok(await info(dirty), 'the window with unsaved typing is still open');
      assert.ok(await coverUp(pageFor('strict-dirty')), 'and it is covered');
      assert.equal(await pageFor('strict-clean-1') === undefined, true, 'no page of the closed window is left');
      await unlock();
      await until(() => pageFor('strict-clean-1') && pageFor('strict-clean-2'), 'both tabs of the closed window to come back', 15000);
      assert.equal(await pageFor('strict-dirty').inputValue('#d'), 'a half-typed draft that must survive', 'the draft survived');
      const leftover = await W(async () => ((await chrome.storage.local.get('strictRestore')).strictRestore || []).length);
      assert.equal(leftover, 0, 'the restore list is emptied');
      await send({ type: 'saveSettings', settings: { hideMode: 'minimize' }, passcode: PASS });
      await closeWin(clean);
      await closeWin(dirty);
      admin = await context.newPage(); await admin.goto(ext('ui/options.html'));
    });

    if (strictWorks) await scenario('strict hiding: a window playing sound is not closed', async () => {
      assert.equal((await send({ type: 'saveSettings', settings: { hideMode: 'close' }, passcode: PASS })).ok, true);
      const w = await create({ url: `${site('strict-audio').split('?')[0]}tone.html?t=strict-audio`, state: 'normal', left: 100, top: 100, width: 800, height: 600 });
      await W((i, url) => chrome.tabs.create({ windowId: i, url, active: false }), w, ext('ui/options.html'));
      await until(() => context.pages().filter((p) => p.url().includes('options.html')).length >= 2, 'a second control page');
      admin = context.pages().filter((p) => p.url().includes('options.html')).at(-1);
      await sleep(2500);
      const audible = await W(async (i) => (await chrome.tabs.query({ windowId: i, audible: true })).length, w);
      if (audible) {
        await lock(); await sleep(1500);
        assert.ok(await info(w), 'a window with a playing tab stays open');
        await unlock();
      }
      await send({ type: 'saveSettings', settings: { hideMode: 'minimize' }, passcode: PASS });
      await closeWin(w);
      admin = await context.newPage(); await admin.goto(ext('ui/options.html'));
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
