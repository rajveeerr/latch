// Runs in every page. While Latch is locked it puts an opaque cover over the page,
// pauses media and swallows keystrokes. It does not edit the page, the title or the
// favicon, and removing the cover leaves everything as it was.
(() => {
  // Latch also injects this into tabs that were already open before it was installed or reloaded, so run once per
  // extension lifetime. A copy left behind by a reload is dead (its chrome.runtime is gone), so a fresh one replaces it.
  const alive = () => { try { return Boolean(chrome.runtime.id); } catch { return false; } };
  if (window.__latchCover && window.__latchCover.alive()) return;
  window.__latchCover = { alive };
  for (const stranded of document.querySelectorAll('[data-latch-cover]')) stranded.remove();   // a cover the dead copy could not remove
  let settings = { coverPages: true, pauseMedia: true, scope: 'profile', lockStyle: 'overlay' };
  let locked = false;
  let host = null;
  let root = null;
  let frame = null;        // the unlock screen (an extension page) shown inside the cover, only in the tab being looked at

  const isTop = window === window.top;
  const isPrivate = chrome.extension?.inIncognitoContext === true;

  // In "private windows only" mode a normal window is none of our business.
  const applies = () => locked && settings.coverPages && (settings.scope !== 'private' || isPrivate);

  function pauseMedia() {
    for (const el of document.querySelectorAll('video, audio')) {
      try { el.pause(); } catch { /* ignore */ }
    }
  }

  function mount() {
    if (!alive() || !isTop || (host && host.isConnected)) return;   // a copy left behind by an extension reload never draws
    const parent = document.documentElement;
    if (!parent) return;     // retried by the observer below
    host = document.createElement('div');
    host.setAttribute('data-latch-cover', '');
    host.setAttribute('popover', 'manual');   // top layer: above dialogs and full-screen video
    host.style.cssText = [
      'position:fixed', 'inset:0', 'margin:0', 'padding:0', 'border:0', 'width:100vw', 'height:100vh',
      'max-width:none', 'max-height:none', 'overflow:hidden', 'background:#f6f4ef', 'z-index:2147483647', 'display:block',
    ].map((rule) => rule + ' !important;').join('');
    root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        :host { color-scheme: light dark; }
        .wrap { position: fixed; inset: 0; display: grid; place-items: center; background: #f6f4ef; color: #14171f;
                font: 14px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
        .card { display: grid; gap: 6px; justify-items: center; text-align: center; padding: 0 24px; }
        svg { width: 30px; height: 30px; margin-bottom: 10px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
        b { font-size: 20px; font-weight: 600; letter-spacing: -.015em; }
        span { color: #565d6f; }
        button { margin-top: 14px; height: 36px; padding: 0 18px; border: 0; border-radius: 10px; cursor: pointer;
                 font: 600 13.5px/1 inherit; color: #fff; background: linear-gradient(180deg, #3d61ec, #2142cf);
                 box-shadow: inset 0 1px 0 rgba(255,255,255,.24), 0 1px 2px rgba(20,40,140,.35); }
        button:focus-visible { outline: 2px solid #f6f4ef; box-shadow: 0 0 0 4px #2b4fdb; }
        iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #f6f4ef; color-scheme: light dark; }
        @media (prefers-color-scheme: dark) {
          .wrap { background: #0b0e16; color: #eef1f8; } span { color: #9aa3ba; }
          button:focus-visible { outline-color: #0b0e16; box-shadow: 0 0 0 4px #7c98ff; }
        }
      </style>
      <div class="wrap" role="dialog" aria-modal="true" aria-label="This window is locked"><div class="card">
        <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9.5" rx="2.5"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/></svg>
        <b>This window is locked</b><span>Your tabs are safe and untouched.</span>
        <button type="button" id="unlock">Unlock</button>
      </div></div>`;
    root.getElementById('unlock').addEventListener('click', () => {
      try { chrome.runtime.sendMessage({ type: 'openUnlockWindow' }); } catch { /* extension reloaded */ }
    });
    parent.appendChild(host);
    try { host.showPopover(); } catch { /* older browsers fall back to z-index */ }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    // Move keyboard focus out of the page and onto the cover, so typing and Tab cannot reach what is behind it.
    try { document.activeElement?.blur(); root.getElementById('unlock').focus(); } catch { /* ignore */ }
    syncFrame();
  }

  // The unlock screen lives in an iframe of one of our own pages, not in this page: a page's own scripts can listen to key
  // presses in its document, but not inside a frame from another origin, so the passcode cannot be read by the site.
  // It is only loaded while this tab is visible, so fifty locked tabs do not load fifty lock screens.
  const wantsFrame = () => applies() && settings.lockStyle !== 'window' && document.visibilityState === 'visible';
  function syncFrame() {
    if (!host || !host.isConnected || !root) return;
    if (!wantsFrame()) { dropFrame(); return; }
    if (frame && frame.isConnected) return;
    frame = document.createElement('iframe');
    frame.title = 'Unlock Latch';
    frame.setAttribute('allow', 'publickey-credentials-get');
    frame.src = chrome.runtime.getURL('ui/lock.html#embed');
    root.append(frame);
    // If the screen does not report back (a page policy blocked the frame), take it away so the plain "Unlock" card shows.
    const mine = frame;
    setTimeout(() => { if (frame === mine && !mine.dataset.ready) { dropFrame(); try { chrome.runtime.sendMessage({ type: 'coverNote' }); } catch { /* extension reloaded */ } } }, 2500);
  }
  function dropFrame() {
    if (frame) { frame.remove(); frame = null; }
    try { root?.getElementById('unlock')?.focus(); } catch { /* ignore */ }
  }
  window.addEventListener('message', (event) => {
    if (!frame || event.source !== frame.contentWindow || event.data?.latch !== 'ready') return;
    frame.dataset.ready = '1';
    try { frame.focus(); } catch { /* ignore */ }
  });
  document.addEventListener('visibilitychange', syncFrame);

  function unmount() {
    if (frame) { frame.remove(); frame = null; }
    if (host) { host.remove(); host = null; root = null; }
  }

  function apply() {
    if (applies()) {
      mount();
      if (settings.pauseMedia) pauseMedia();
    } else {
      unmount();
    }
  }

  // Keep the cover in place if the page removes it, and cover a document that is still loading.
  new MutationObserver(() => { if (applies() && (!host || !host.isConnected)) apply(); })
    .observe(document, { childList: true, subtree: true });

  // Anything that starts playing while locked (autoplay, next video) is stopped.
  document.addEventListener('play', (event) => {
    if (applies() && settings.pauseMedia && event.target instanceof HTMLMediaElement) event.target.pause();
  }, true);

  // The page must not react to keys while locked: no typing into its fields, no hotkeys, no Tab into it.
  // The cover's own button still works, and browser shortcuts are left alone.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    window.addEventListener(type, (event) => {
      if (!applies() || (host && event.composedPath().includes(host))) return;
      event.stopImmediatePropagation();
      event.preventDefault();
    }, true);
  }

  function load(values) {
    settings = { ...settings, ...(values.settings || {}) };
    locked = Boolean(values.state && values.state.locked);
    apply();
  }

  // The worker asks the top frame whether it is really covering the page, so it can tell if a window is exposed.
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'latch-ping' || !isTop) return false;
    respond({ covered: Boolean(host && host.isConnected) });
    return false;
  });

  chrome.storage.local.get(['state', 'settings'], load);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(changes.state || changes.settings)) return;
    chrome.storage.local.get(['state', 'settings'], load);
  });
})();
