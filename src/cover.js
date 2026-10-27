// Runs in every page. While Latch is locked it puts an opaque cover over the page,
// pauses media and swallows keystrokes. It does not edit the page, the title or the
// favicon, and removing the cover leaves everything as it was.
(() => {
  let settings = { coverPages: true, pauseMedia: true, scope: 'profile' };
  let locked = false;
  let host = null;

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
    if (!isTop || (host && host.isConnected)) return;
    const parent = document.documentElement;
    if (!parent) return;     // retried by the observer below
    host = document.createElement('div');
    host.setAttribute('popover', 'manual');   // top layer: above dialogs and full-screen video
    host.style.cssText = [
      'position:fixed', 'inset:0', 'margin:0', 'padding:0', 'border:0', 'width:100vw', 'height:100vh',
      'max-width:none', 'max-height:none', 'overflow:hidden', 'background:#f4f2ee', 'z-index:2147483647', 'display:block',
    ].map((rule) => rule + ' !important;').join('');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        :host { color-scheme: light dark; }
        .wrap { position: fixed; inset: 0; display: grid; place-items: center; background: #f4f2ee; color: #1a1917;
                font: 14px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
        .card { display: grid; gap: 6px; justify-items: center; text-align: center; padding: 0 24px; }
        svg { width: 30px; height: 30px; margin-bottom: 10px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
        b { font-size: 20px; font-weight: 600; letter-spacing: -.015em; }
        span { color: #66635b; }
        button { margin-top: 14px; height: 36px; padding: 0 18px; border: 0; border-radius: 10px; cursor: pointer;
                 font: 600 13.5px/1 inherit; color: #f7f5f0; background: linear-gradient(180deg, #3a3834, #1a1917);
                 box-shadow: inset 0 1px 0 rgba(255,255,255,.16), 0 1px 2px rgba(0,0,0,.25); }
        button:focus-visible { outline: 2px solid #f4f2ee; box-shadow: 0 0 0 4px #2b7a68; }
        @media (prefers-color-scheme: dark) {
          .wrap { background: #121211; color: #f1efea; } span { color: #a8a59c; }
          button { color: #1a1917; background: linear-gradient(180deg, #f7f5f0, #d9d6cd); box-shadow: inset 0 1px 0 rgba(255,255,255,.5), 0 1px 2px rgba(0,0,0,.4); }
          button:focus-visible { outline-color: #121211; box-shadow: 0 0 0 4px #5cbfa6; }
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
  }

  function unmount() {
    if (host) { host.remove(); host = null; }
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

  chrome.storage.local.get(['state', 'settings'], load);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(changes.state || changes.settings)) return;
    chrome.storage.local.get(['state', 'settings'], load);
  });
})();
