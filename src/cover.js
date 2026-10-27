// Runs in every page. While Latch is locked it puts an opaque cover over the page,
// pauses media and swallows keystrokes. It does not edit the page, the title or the
// favicon, and removing the cover leaves everything as it was.
(() => {
  let settings = { coverPages: true, pauseMedia: true };
  let locked = false;
  let host = null;

  const isTop = window === window.top;

  function pauseMedia() {
    for (const el of document.querySelectorAll('video, audio')) {
      try { el.pause(); } catch { /* ignore */ }
    }
  }

  function mount() {
    if (!isTop || !settings.coverPages || (host && host.isConnected)) return;
    const parent = document.documentElement;
    if (!parent) return;     // retried by the observer below
    host = document.createElement('div');
    host.setAttribute('popover', 'manual');   // top layer: above dialogs and full-screen video
    host.style.cssText = [
      'position:fixed', 'inset:0', 'margin:0', 'padding:0', 'border:0', 'width:100vw', 'height:100vh',
      'max-width:none', 'max-height:none', 'overflow:hidden', 'background:#0c0e13', 'z-index:2147483647', 'display:block',
    ].map((rule) => rule + ' !important;').join('');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .wrap { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
                gap: 14px; font: 15px -apple-system, system-ui, sans-serif; color: #c9ced9; background: #0c0e13; }
        svg { width: 56px; height: 56px; }
        b { font-size: 20px; color: #fff; font-weight: 600; }
      </style>
      <div class="wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fb542b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>
        </svg>
        <b>Locked</b><span>Unlock with Latch to continue.</span>
      </div>`;
    parent.appendChild(host);
    try { host.showPopover(); } catch { /* older browsers fall back to z-index */ }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  function unmount() {
    if (host) { host.remove(); host = null; }
  }

  function apply() {
    if (locked) {
      mount();
      if (settings.pauseMedia) pauseMedia();
    } else {
      unmount();
    }
  }

  // Keep the cover in place if the page removes it, and cover a document that is still loading.
  new MutationObserver(() => { if (locked && (!host || !host.isConnected)) apply(); })
    .observe(document, { childList: true, subtree: true });

  // Anything that starts playing while locked (autoplay, next video) is stopped.
  document.addEventListener('play', (event) => {
    if (locked && settings.pauseMedia && event.target instanceof HTMLMediaElement) event.target.pause();
  }, true);

  // The page must not react to keys while locked (media shortcuts, hotkeys). Browser shortcuts still work.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    window.addEventListener(type, (event) => { if (locked && settings.coverPages) event.stopImmediatePropagation(); }, true);
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
