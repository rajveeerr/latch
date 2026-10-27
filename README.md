<p align="center">
  <img src="docs/logo.png" alt="Latch" width="88">
</p>

<h1 align="center">Latch</h1>

<p align="center">
  <b>Lock Brave like Safari locks private windows.</b><br>
  A tiny passcode and Touch ID lock that covers your browser when you step away,<br>and never closes or changes a single tab.
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
  <img src="https://img.shields.io/badge/permissions-3-2b4fdb" alt="3 permissions">
  <img src="https://img.shields.io/badge/network-none-2b4fdb" alt="no network">
  <img src="https://img.shields.io/badge/license-MIT-14171f" alt="MIT">
</p>

<p align="center">
  <img src="docs/screenshots/lock-light.png" alt="The Latch lock screen: a trading card of Kerby, the guard pup, beside the passcode field" width="880">
</p>

## Why I built this

I always wanted a **native lock in Brave**, like the one Safari has for private windows. It never shipped.

So I used a lock extension. It crashed my browser at random and **lost my saved and grouped tabs** more than once. That was the last straw. I built the lock I wanted: fast like a native feature, light, secure, with the good features, and it **never closes or touches a tab**.

I was not alone. Brave's own tracker lists [password protection for tabs and profiles](https://github.com/brave/brave-browser/issues/42457) as P5, *"not on the official roadmap"*, and a community thread asking for [a password for the browser itself](https://community.brave.app/t/a-password-for-the-browser-itself/97057) has been running since December 2019. People wanted it for shared family PCs, guests and open desks, and they did not trust extensions that ask for many permissions. Latch asks for three.

## Who it is for

- You leave Brave open at home, at work or at school, and someone else could walk up to it.
- You share a computer with family or roommates and want your logins, history and tabs to stay yours.
- You have lost tabs to a lock extension before and never want to again.

## What you get

| | |
|---|---|
| **Passcode lock** that covers every page, pauses media and mutes tabs | **Touch ID** (beta) through WebAuthn, with your passcode always as backup |
| **Private windows only** mode, like Safari, so the rest of the browser stays open | **Auto-lock** after inactivity, in the background, on sleep or at startup |
| **Recovery code**, so a forgotten passcode never means removing the extension | **Activity log** of locks, unlocks and wrong guesses, on your computer only |
| **Kerby**, a three-headed guard pup who closes his eyes while you type and growls at a wrong guess | **Light and dark** that follow your system, in a calm native-feeling interface |

<p align="center">
  <img src="docs/screenshots/onboarding-welcome.png" alt="Onboarding with Kerby" width="300">
  &nbsp;
  <img src="docs/screenshots/lock-growl.png" alt="Kerby growling at a wrong passcode" width="300">
  &nbsp;
  <img src="docs/screenshots/popup-light.png" alt="The toolbar popup" width="170">
</p>

## Install in a minute

Latch is not in a web store yet, so you load it as an unpacked extension.

1. [Download the latest zip](https://github.com/rajveeerr/latch/releases/latest) and unzip it somewhere permanent. The browser reads it from that folder, so do not delete it.
2. Open `brave://extensions` and switch on **Developer mode**.
3. Click **Load unpacked** and choose the unzipped folder (the one with `manifest.json` in it).
4. Kerby says hello. Pick a passcode and **save your recovery code**. Optionally, switch on **Allow in private** in the extension's details so private windows are covered too.

Latch locks the profile it is installed in. Install it in each profile you want to protect. `Control+Shift+L` locks instantly.

## Pair it with your Mac's lock

Latch covers your browser. macOS covers everything else. Press **Control + Command + Q** to lock your Mac whenever you step away, and in System Settings turn on *Require password immediately* after sleep or screen saver. Together they cover the whole machine.

## Light and fast

Measured on a MacBook with Chromium:

| | |
|---|---|
| Download | **207 KB** (fonts and art included) |
| Script on every web page | **5 KB**, which only draws a cover and reads nothing |
| Lock screen first paint | **~70 ms** (popup ~60 ms, settings ~90 ms) |
| Permissions | **3**: `storage`, `idle`, `alarms` |
| Network, accounts, analytics | **none** |

<details>
<summary><b>How it compares</b></summary>

Other lockers are worth knowing about: [Locksy](https://www.locksy.dev/) (per-tab and per-site locks), Chrome Lock Pro, [Secure Browser Lock](https://github.com/benjamindimalanta/secure-browser-lock) and Browserlock. Latch's angle is different: it never destroys state, it has a recovery path, it guides you into private windows, and it stays tiny. It does **not** (yet) do per-site locks, schedules or decoy PINs. The full notes, with sources, are in [docs/research.md](docs/research.md).

</details>

<details>
<summary><b>Honest limits</b></summary>

Latch is a **privacy lock for a browser you leave on a desk**, not a security boundary.

- **The install prompt will say Latch can read and change data on all sites.** That is how any extension covers pages: a 5 KB script runs on every page to draw the cover. It reads nothing and sends nothing, and the code is right here to check.
- It stops a casual passer-by, not someone with time, skill or a terminal. A browser extension cannot hide the tab strip, so minimizing is best effort and a lock window sits in front.
- **Private windows only** mode is lighter protection: no lock window in front, just the page cover, which DevTools can remove.
- Anyone who can reach `brave://extensions` can remove Latch. Use your computer's own lock and a sign-in password too.
- The passcode hash lives in the profile folder. Use a long passphrase, not four digits.
- **Touch ID is beta.** The WebAuthn logic is tested with a virtual authenticator in Chromium and Brave, not yet on real Touch ID hardware in Brave.

</details>

<details>
<summary><b>Develop</b></summary>

```sh
npm install                  # only for the tests and the art scripts
npm test                     # 41 unit tests: passcode, recovery, WebAuthn, settings, safety rules
BRAVE=1 npm run test:e2e     # 17 end-to-end checks in real Brave with a throwaway profile
npm run zip                  # dist/latch-<version>.zip
node scripts/make-icons-sprite.mjs   # icons from Lucide
node scripts/build-site.mjs          # copy shared assets into site/
```

The safety test fails the build if any code closes, reloads, discards or navigates a tab, closes a window other than its own lock window, asks for more permissions or touches the network. Kerby, the painted scene and the isometric latch are drawn in code (`ui/kerby.js`, `ui/scene.js`, `scripts/make-mechanism.mjs`).

</details>

## Credits

Fonts: [Geist](https://github.com/vercel/geist-font) and [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) (OFL). Icons: [Lucide](https://lucide.dev) (ISC). Built by [@rajveeerr](https://github.com/rajveeerr). [MIT](LICENSE).
