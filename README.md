<p align="center">
  <img src="docs/logo.png" alt="Latch" width="88">
</p>

<h1 align="center">Latch</h1>

<p align="center">
  <b>Lock your Chromium browser (Brave, Chrome, Edge) like Safari locks private windows.</b><br>
  A tiny passcode and Touch ID lock that covers your browser when you step away,<br>and never closes or changes a tab on its own.
</p>

<p align="center">
  <a href="https://rajveeerr.github.io/latch/">Website</a> ·
  <a href="#install-in-a-minute">Install</a> ·
  <a href="https://github.com/rajveeerr/latch/releases/latest">Download</a> ·
  <a href="docs/research.md">Research</a>
</p>

<p align="center">
  <a href="https://github.com/rajveeerr/latch/actions/workflows/test.yml"><img src="https://github.com/rajveeerr/latch/actions/workflows/test.yml/badge.svg" alt="tests"></a>
  <img src="https://img.shields.io/badge/download-207%20KB-2b4fdb" alt="206 KB">
  <img src="https://img.shields.io/badge/permissions-6-2b4fdb" alt="6 permissions">
  <img src="https://img.shields.io/badge/network-none-2b4fdb" alt="no network">
  <img src="https://img.shields.io/badge/license-MIT-14171f" alt="MIT">
</p>

<p align="center">
  <img src="docs/screenshots/lock-light.png" alt="The Latch lock screen: a 3D combination lock with the passcode field right below it" width="880">
</p>

## Why I built this

I always wanted a **native lock in my browser**, like the one Safari has for private windows. Brave, which I use, never shipped one.

So I used a lock extension. It crashed my browser at random and **lost my saved and grouped tabs** more than once. That was the last straw. I built the lock I wanted: fast like a native feature, light, secure, with the good features, and it **never closes or touches a tab**.

I was not alone. Brave's own tracker lists [password protection for tabs and profiles](https://github.com/brave/brave-browser/issues/42457) as P5, *"not on the official roadmap"*, and a community thread asking for [a password for the browser itself](https://community.brave.app/t/a-password-for-the-browser-itself/97057) has been running since December 2019. People wanted it for shared family PCs, guests and open desks, and they did not trust extensions that ask for many permissions. Latch asks for six permissions, all explained below, and none of them reach the network.

## Who it is for

- You leave your browser open at home, at work or at school, and someone else could walk up to it.
- You share a computer with family or roommates and want your logins, history and tabs to stay yours.
- You have lost tabs to a lock extension before and never want to again.

## What you get

| | |
|---|---|
| **Passcode lock** that covers every page, pauses media and mutes tabs | **Touch ID** (beta) through WebAuthn, with your passcode always as backup |
| **Private windows only** mode, like Safari, so the rest of the browser stays open | **Auto-lock** after inactivity, in the background, on sleep or at startup |
| **Recovery code**, so a forgotten passcode never means removing the extension | **Activity log** of locks, unlocks and wrong guesses, on your computer only |
| **Kerby**, a three-headed marble guard pup (and **Aegis**, a hoplite) who closes his eyes while you type and growls at a wrong guess | **Make it yours**: pick the lock screen (a combination lock or a trading card) and the mascot (Aegis, Kerby, or none) | **A lock screen that feels physical**: a brass combination lock whose dial turns as you type, whose lamp flashes red on a wrong guess, and whose shackle lifts when it opens | **Light and dark** that follow your system, in a calm native-feeling interface |

<p align="center">
  <img src="docs/screenshots/onboarding-welcome.png" alt="Onboarding with Aegis" width="300">
  &nbsp;
  <img src="docs/screenshots/lock-wrong.png" alt="The lock rejecting a wrong passcode" width="300">
  &nbsp;
  <img src="docs/screenshots/popup-light.png" alt="The toolbar popup" width="170">
</p>

## Browsers and systems

Latch is a standard Manifest V3 extension, so it runs in Chromium-based browsers. What has actually been tried:

| Browser | The extension | The Mac helper | Tested |
|---|---|---|---|
| Brave | yes | yes | Brave 156 on macOS, with the automated tests |
| Chromium | yes | yes | A Chromium test build on macOS, with the automated tests |
| Google Chrome | should work, same code | the installer registers it | not tested |
| Microsoft Edge | should work, same code | the installer registers it | not tested |
| Vivaldi, Opera, Arc | probably | not registered by the installer | not tried |

The extension has only been tested on macOS. The helper is macOS only; on Windows and Linux Latch locks on the page or with a separate lock window. If you try another browser or system, an issue saying what happened helps a lot.

## Install in a minute

Latch is not in a web store yet, so you load it as an unpacked extension.

1. [Download the latest zip](https://github.com/rajveeerr/latch/releases/latest) and unzip it somewhere permanent. The browser reads it from that folder, so do not delete it.
2. Open your browser's extensions page (`brave://extensions`, `chrome://extensions` or `edge://extensions`) and switch on **Developer mode**.
3. Click **Load unpacked** and choose the unzipped folder (the one with `manifest.json` in it).
4. Aegis says hello. Pick a passcode and **save your recovery code**. Optionally, switch on **Allow in private** in the extension's details so private windows are covered too.

Latch locks the profile it is installed in. Install it in each profile you want to protect. `Control+Shift+L` locks instantly.

### The Mac helper (recommended on macOS)

A page cannot draw over a browser's tab strip and address bar, and a browser extension cannot minimize or move windows without jumping them around. The helper is a tiny Mac app (about 120 KB, built from `native/helper/main.swift`) that the browser starts only while Latch is locked. It draws an opaque lock exactly over each window of that profile, tab strip and address bar included, over full-screen windows too, with no new browser window and nothing minimized or moved. You type the passcode into the helper, never into a web page; the extension still checks it.

**Install: double-click `Install Latch Helper.command` in the Latch folder.** That is the whole job. It is a one-time step that takes a second and needs no developer tools (the helper is prebuilt for Apple Silicon and Intel). It survives browser updates and reloading Latch; only moving the Latch folder needs it again, and Latch's settings say so. Latch's settings notice the install by themselves: open them, pick **Native Mac helper**, and the card changes to *Helper found* with nothing to click or reload. If macOS says it cannot verify the file (it can when the folder came from a download), right-click it and choose **Open** once. Switch on **Unlock with Touch ID on the lock screen** there to get a fingerprint button on the helper's lock (Return on an empty field uses it too); macOS shows its own Touch ID sheet, and the passcode always works as well. `Uninstall Latch Helper.command` removes it (so does `./native/uninstall.sh`).

## Pair it with your Mac's lock

Latch covers your browser. macOS covers everything else. Press **Control + Command + Q** to lock your Mac whenever you step away, and in System Settings turn on *Require password immediately* after sleep or screen saver. Together they cover the whole machine.

## Light and fast

Measured on a MacBook with Chromium:

| | |
|---|---|
| Download | **207 KB** (fonts and art included) |
| Script on every web page | **5 KB**, which only draws a cover and reads nothing |
| Lock screen first paint | **~70 ms** (popup ~60 ms, settings ~90 ms) |
| Permissions | **6**: `storage`, `idle`, `alarms`, `scripting`, `tabGroups`, `nativeMessaging` (why: see below) |
| Network, accounts, analytics | **none** |

<details>
<summary><b>How it compares</b></summary>

Other lockers are worth knowing about: [Locksy](https://www.locksy.dev/) (per-tab and per-site locks), Chrome Lock Pro, [Secure Browser Lock](https://github.com/benjamindimalanta/secure-browser-lock) and Browserlock. Latch's angle is different: it never destroys state, it has a recovery path, it guides you into private windows, and it stays tiny. It does **not** (yet) do per-site locks, schedules or decoy PINs. The full notes, with sources, are in [docs/research.md](docs/research.md).

</details>

<details>
<summary><b>Why each permission</b></summary>

- `storage`: your settings and the hashed passcode, on this computer.
- `idle`: knowing when you have been away, or the screen locked.
- `alarms`: the timer for "locks after the browser has been in the background".
- `scripting` and all sites: puts the lock cover into tabs that were already open (a page script only loads in pages opened after an extension is installed). This is why the browser says Latch can "read and change data on all sites". It reads nothing and sends nothing.
- `tabGroups`: only for the optional strict mode, to put tab groups (name, colour, collapsed) back when it reopens windows.
- `nativeMessaging`: only to talk to the optional Mac helper below. Without the helper installed it does nothing.

</details>

<details>
<summary><b>How windows are hidden, and strict mode</b></summary>

**Three ways to lock, chosen in settings.** *Native Mac helper* (the default when installed): the helper covers each window, tab strip included, and nothing in the browser moves. *On the page*: every visible tab gets an opaque cover with the unlock screen in it, so you type the passcode right where your window is; nothing opens, moves or minimizes, but a page cannot cover the tab strip. The unlock screen is a frame of one of Latch's own pages, so a website cannot read what you type; it is only loaded in the tab you are looking at. *Separate lock window*: a window covers the screen and this profile's windows are minimized. With the page cover, a window whose visible tab cannot hold a cover (the new tab page, the browser's own settings pages such as `brave://` or `chrome://`, the web store) is minimized instead, and if no window can hold the cover Latch opens a small unlock window, so there is always a way back in. Touch ID in these two styles opens that small window, because it is tied to Latch's own address; the helper uses macOS's own Touch ID instead.

The **tab strip and address bar stay visible** under the page cover, which a page cannot draw over (the helper does not have this limit). If you have no helper and that matters more to you than staying put, choose **Separate lock window** in settings: a lock window rises over the screen and this profile's windows are minimized (a full-screen window steps out of full screen first). On unlock the lock window closes first, normal windows return, full-screen windows re-enter full screen last, and focus goes back to the window you were using. Latch only ever sees and touches the profile it is installed in.

**Stage Manager and Mission Control** can show live thumbnails of windows that are not minimized. With the overlay, a thumbnail is a picture of the covered window, so it shows the lock screen and the tab strip, not your page (not yet checked on a real Stage Manager strip). Measured in Brave 156 with Stage Manager on: some windows stayed in the side strip as small thumbnails while locked, even after being asked to minimize again. Their pages show the lock cover, but the tab strip is still part of the picture. Setting **Lock window: full screen** puts the lock in its own Space, which is the best an extension can do (not yet confirmed to hide the strip). For a stricter result, macOS has an opt-in **Hide windows completely** switch (only with the *Separate lock window* style): windows are closed while locked and reopened on unlock, so nothing shows anywhere. It never closes a window with unsaved typing or sound, saves what it closed before closing it, and reports anything it cannot reopen. It is riskier for your tabs than the default, which is why it is off. **Brave currently refuses it**: closing windows from an extension asks for confirmation on multi-tab windows and, in testing, crashed Brave 155 when repeated. Latch checks this when you switch it on. More on the options that were weighed: [docs/approaches.md](docs/approaches.md). What to test by hand: [docs/manual-tests.md](docs/manual-tests.md).

</details>

<details>
<summary><b>Honest limits</b></summary>

Latch is a **privacy lock for a browser you leave on a desk**, not a security boundary.

- **The install prompt will say Latch can read and change data on all sites.** That is how any extension covers pages: a 5 KB script runs on every page to draw the cover. It reads nothing and sends nothing, and the code is right here to check.
- It stops a casual passer-by, not someone with time, skill or a terminal. A browser extension cannot hide the tab strip, so the default overlay leaves tab titles and the address bar visible; the lock-window style hides more but moves windows.
- **The page cover can be removed with DevTools.** In *On the page* style, in *Private windows only* mode, and in the helper style when the helper is not installed, the lock is a cover drawn in the page. The helper's lock is a separate program's window and DevTools cannot touch it.
- **The helper covers windows by their position and size, not by profile.** A browser tells a program which windows exist but not which profile each belongs to, so with two profiles open at exactly the same place and size, a lock can also cover the other profile's window. Picture-in-Picture and other floating windows are not covered, and Stage Manager's and Mission Control's thumbnails are drawn by macOS from the real windows (the helper does cover Stage Manager's side-strip tiles).
- **The helper is not signed by Apple.** Built here it runs without a prompt. A copy that arrives in a download can be blocked on first open: right-click and choose Open once. A signed and notarized build would remove that, and is not done yet.
- Anyone who can reach your browser's extensions page can remove Latch. Use your computer's own lock and a sign-in password too.
- The passcode hash lives in the profile folder. Use a long passphrase, not four digits.
- **Touch ID is beta.** The browser's own Touch ID (WebAuthn) is tested with a virtual authenticator, not yet on real hardware. The helper's Touch ID uses macOS's own sheet; the tests simulate the fingerprint being accepted, and a real finger has not been tried by anyone but you.

</details>

<details>
<summary><b>Develop</b></summary>

```sh
npm install                  # only for the tests and the art scripts
npm test                     # 47 unit tests: passcode, recovery, WebAuthn, settings, safety rules
BRAVE=1 npm run test:e2e     # 21 end-to-end checks in real Brave with a throwaway profile
npm run test:native          # the Mac helper end to end: a real helper started by a real browser (macOS)
npm run zip                  # dist/latch-<version>.zip
node scripts/make-icons-sprite.mjs   # icons from Lucide
```

The safety test fails the build if any code closes, reloads, discards or navigates a tab, closes a window other than its own lock window, asks for more permissions or touches the network. Window behaviour is covered by `npm run test:windows` (about 25 scenarios across normal, maximized, half-screen, full screen, minimized, several windows, tabs and windows opened or closed while locked, and the in-page overlay), `npm run test:native` (the Mac helper), `npm run test:profiles` (Latch never touches another profile) and `npm run test:autolock`. Kerby, Aegis, the painted scene and the combination lock are drawn in code (`ui/kerby.js`, `ui/aegis.js`, `ui/scene.js`, `ui/lockdial.js`).

</details>

## Credits

Fonts: [Geist](https://github.com/vercel/geist-font) and [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) (OFL). Icons: [Lucide](https://lucide.dev) (ISC). Built by [@rajveeerr](https://github.com/rajveeerr). [MIT](LICENSE).
