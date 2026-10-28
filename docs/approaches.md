# How Latch hides your browser, and the approaches that were weighed

The goal is what Safari does natively: when locked, nothing of the window leaks, it is instant, and nothing is lost.
An extension cannot draw over the browser's own chrome (tab strip, address bar), so it has to combine tricks.

| # | Approach | Hides page | Hides tab strip / URL | Speed | Keeps your data | Verdict |
|---|---|---|---|---|---|---|
| 1 | **Cover every page** (content script, top layer, closed shadow root) | yes | no | instant | yes | **Used.** The first and fastest layer. Injected into already-open tabs too. |
| 2 | **Lock window on top** (maximized, or real full screen) | yes, on this screen | yes, while it is on top | fast | yes | **Used.** Closing it brings it straight back. |
| 3 | **Minimize this profile's windows** (full-screen windows step out of full screen first), restored on unlock | yes | yes | animated (about 0.5 s) | yes | **Used.** The only way to hide the tab strip itself. Full screen is its own macOS Space and cannot be minimized directly, so there is a visible step out and back in. Security wins over avoiding that animation. |
| 4 | Close windows, restore from session on unlock | yes, **nothing in Stage Manager, Mission Control or the Dock** | yes | fast to hide, slower to restore | **mostly** (unsaved typing and playing media are not kept) | **Offered as an opt-in strict mode, macOS only, off by default.** Fenced: waits for the lock window, never closes a window with unsaved typing or sound, saves the list first, verifies the window really closed, falls back to rebuilding from saved addresses, and reports what it cannot reopen. Verified to work in Chromium. **Brave refuses it** (it keeps multi-tab windows open to ask), and Latch checks that before allowing it. This is the approach that cost people their tabs before, so it is never the default. |
| 5 | Discard tabs or navigate them to a lock page | yes | no | fast | **no** (forms, scroll, playing media) | Rejected. |
| 6 | Move or shrink windows off screen | partly | partly | fast | yes | Rejected. macOS keeps a window's title bar on screen, and resizing wrecks the user's layout. |
| 7 | Native helper app drawing a lock over each window (like Safari's own treatment) | yes | yes | instant | yes | **Built (`native/`), the default when installed.** A small Mac program the browser starts through native messaging while locked. It draws an opaque lock exactly over each window of the profile (checked within 3 px in tests, over full-screen windows too), takes the passcode, and hands it to the extension to verify. Needs a one-time double-click of `Install Latch Helper.command` and the `nativeMessaging` permission; without it Latch falls back to approach 1. Stage Manager and Mission Control still show the real windows. |
| 8 | A real lock built into the browser | yes | yes | instant | yes | The best answer, and only Brave can ship it (brave-browser #42457, currently not on the roadmap). |

## Three lock styles

Latch offers three ways to lock, chosen in settings (`lockStyle`). **Native Mac helper** (the default; approach 7) covers each window from outside the browser. **On the page** (approach 1 alone) puts the cover and unlock screen in the visible tab. **Separate lock window** is the combination of approaches 1, 2 and 3 described below, with windows minimized. The helper falls back to *On the page* when it is not installed, and *On the page* minimizes a window whose visible tab cannot hold a cover (rows 2 and 3 apply to those). The rest of this page describes the older, separate-window flow, which is still what that third style does.

## Order matters

When you lock: (1) every tab is covered, (2) the lock window rises, (3) windows are taken out of the way. The cover is instant,
so the animated part never leaves anything on show. When you unlock: the lock window closes first, normal windows come back,
full-screen windows re-enter full screen last, and focus returns to the window you were using.

## What an extension cannot do

- Cover a page the browser protects (`brave://` pages, the web store, PDF viewer). Those rely on the lock window and minimizing.
- Stop someone who can open `brave://extensions` from removing Latch. It is a privacy lock, not a vault.
- Show anything over another macOS Space: swiping to a different Space while locked is not something it can block.

## Scope

An extension is installed per profile, and the browser only gives it that profile's windows and tabs. Latch never sees or touches
another profile's windows.
