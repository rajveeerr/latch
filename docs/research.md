# Research notes

What other browser lockers offer, what their users run into, and what that means for Latch.
Everything here comes from public pages (linked). Vendor pages and vendor blog posts describe
their own products, so treat their claims and rankings as self-reported.

## What people are asking Brave for

| Source | What it says |
|---|---|
| [brave-browser #42457](https://github.com/brave/brave-browser/issues/42457) | "Password-Protection on Tabs and/or Profiles", opened Nov 2024. Labelled `priority/P5`, which a maintainer clarified means it is not on the official Brave roadmap. A May 2026 comment suggests profile-level protection that also encrypts local data. |
| [brave-browser #54226](https://github.com/brave/brave-browser/issues/54226) | A request for a simple 4 to 8 digit password lock for desktop profiles, closed as a duplicate of #42457 in April 2026. |
| [brave-core #36413](https://github.com/brave/brave-core/pull/36413) | An Android "browser-wide lockdown" pull request, so the idea exists inside Brave, just not on desktop. |
| [Brave Community: "A password for the browser itself"](https://community.brave.app/t/a-password-for-the-browser-itself/97057) | Running since December 2019. Use cases: a shared family PC, guests, a family laptop. Pain points: logging out each time is a hassle; saved passwords are visible to anyone at the keyboard; an extension like LockPW is distrusted because it asks for many permissions; extensions add clutter and resource use; some people stay on Firefox for its master password. |
| [Brave Community: "Password lock / encrypt Brave Browser"](https://community.brave.com/t/password-lock-encrypt-brave-browser-for-security-and-privacy-reasons/103127/17) | A reply says an issue is open, that many people use external password managers, and that the user experience is hard to get right. |

I could not reach Reddit with the research tools used here, so no Reddit threads are cited.

What this changed in Latch: **three permissions and no network** (the distrust of extensions), **a tiny download and a 5 KB page script** (clutter and resource use), **never closing tabs** (the maker's own lost tabs), a **recovery code** (lockouts), and a Safari-style **private windows only** mode (the request people keep making).

## What exists

| Product | What it offers | Notes |
|---|---|---|
| [Locksy](https://www.locksy.dev/) | Per-tab and per-domain locks, auto-lock timers, scheduled locks, Touch ID through WebAuthn, "stealth mode", intruder photos, weekly reports | Free tier is limited; Pro is a one-time $4.99. Its own [comparison post](https://www.locksy.dev/blog/best-tab-locking-extensions-2026) ranks it first. |
| Chrome Lock Pro | Manual, startup and idle locking, decoy PIN, offline recovery | [Store listing](https://chromewebstore.google.com/detail/chrome-lock-browser-passw/dfncaoemjmmnbcfldoochfgkhenhegjl) |
| [Secure Browser Lock](https://github.com/benjamindimalanta/secure-browser-lock) | PIN lock for Chrome, Brave and Edge, idle timeout, shortcut, PBKDF2 | Open source. Its README notes that Brave and Edge can close immediately on open, so it ships emergency reset scripts. |
| Browserlock | "Lossless" mode that hides windows and restores them with tabs, groups, scroll position and form input intact, and a "Strict" mode | [Store listing](https://chromewebstore.google.com/detail/browserlock-%E2%80%93-password-lo/mpcpjgccepicdlfcdaackbolpimhcgnb) |
| Older overlay lockers (Tab Lock, LockPW) | A password overlay on tabs | Described by a competitor as unmaintained, loading the page behind the overlay, and removable from DevTools. |
| Safari | Private windows lock when you step away and need Touch ID or your password | The inspiration for Latch's "private windows only" mode. |

## What goes wrong for users

- **Lost passcode, lost access.** An Opera forum thread has people locked out of a browser lock with no way to renew the password. Competing tools say that forgetting the passcode and the recovery code means removing and reinstalling the extension.
- **Private windows are skipped** unless the user finds "Allow in Incognito" on the extension card, and most tools do not guide them there.
- **Overlays are easy to remove.** A cover that is only a page element can be deleted from DevTools; the page underneath is still running.
- **Browsers closing or crashing.** Locks that quit the browser or close windows can lose tabs, groups and drafts.
- **Browser-internal pages are not covered** by content scripts (settings, new tab page, the web store).

## What Latch did about it

| Finding | Decision |
|---|---|
| Forgotten passcodes | A 100-bit offline **recovery code** at setup, with a forgot-passcode path on the lock screen, plus the ability to make a new one. |
| Private windows skipped | An **incognito check** that explains what is missing and opens the right page, and a Safari-style **private windows only** mode. |
| Overlay-only locks | A separate **lock window** in front of everything (in "everything" mode), minimized windows, paused media. The cover is one layer of several. |
| Lost tabs | Latch **never closes, reloads, discards or navigates** anything. A test fails the build if that changes. |
| Internal pages | Covered by the lock window rather than by a content script. |
| Wanting biometrics | **Touch ID unlock** through WebAuthn, checked locally, hidden where unsupported, labelled beta. |
| Wanting to know if someone tried | An **activity log** of locks, unlocks and wrong guesses, with a notice in the toolbar popup. |
| Trust | No network, no accounts, no analytics, three permissions, MIT licensed. |

## Not built yet, and why

- **Per-site or per-tab locks** (Locksy's main idea). Valuable, but it needs its own unlock sessions and a list editor. Planned.
- **Scheduled locks.** Easy to add; wanted by some, not by most.
- **Decoy PIN / decoy page.** Interesting, but it can mislead the owner as easily as an intruder.
- **Intruder photos.** Needs camera access, which would break the "three permissions, no network" promise. Deliberately skipped.
- **Firefox and Safari.** Different extension APIs; the lock window approach does not carry over unchanged.

## Design references

[Recent](https://recent.design) and [Vibrant](https://www.vibrant.design) were used for general direction: quiet, product-first interfaces,
monochrome palettes and authored illustration over decoration. The isometric latch mechanism follows the rules of the
[Anatomy](https://skills.wheresryan.sh/anatomy) approach (isometric camera at 30 degrees, solid depth-sorted parts, four shading
tones, one accent on the lit part, no text inside the drawing). The marble bust is hand-built SVG shapes.
