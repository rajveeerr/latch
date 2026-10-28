# What to test by hand

The automated tests drive real Chromium and Brave through every window state they can reach (`npm run test:windows`,
`BRAVE=1 npm run test:windows`, `npm run test:autolock`). These are the cases a script cannot reach. Please check them on your own
machine, and tell me what you see.

## macOS windows
- [ ] **Green button full screen**: open a window, click the green button, lock (`Control+Shift+L`). The window should leave
      full screen and the lock screen should be the only thing visible. Unlock: your window returns to full screen and has focus.
- [ ] **Window maximized by double-clicking the title bar**: lock and unlock. It comes back the same size and place.
- [ ] **Half screen (drag to an edge, or Option-click the green button)**: lock and unlock. Same size and place.
- [ ] **Split View** (two windows side by side in full screen): lock and unlock.
- [ ] **Stage Manager on and off**: lock and unlock in each. The lock screen covers the screen and no stage thumbnail shows page content.
- [ ] **Mission Control and Spaces**: while locked, swipe to another Space and back. (An extension cannot block this, so note what you see.)
- [ ] **Cmd+Tab and clicking the Dock icon while locked**: you should land on the lock screen, never on a window with tabs.
- [ ] **Two displays**: lock with windows on both. Both screens are covered, or tell me which one is not.
- [ ] **A window you minimized yourself**: lock and unlock. It stays minimized.
- [ ] **Tabs that were open before you loaded or reloaded Latch**: lock. Their pages are covered. (Latch puts the cover into them when it locks.)
> These first checks describe the **Separate lock window** style (Settings, How Latch locks). With the default **Native Mac helper**, or **On the page**, a full-screen window stays in full screen and nothing is minimized: see the helper checks at the end of this file.

- [ ] **New tab page and `brave://settings` in full screen**: lock. The window should leave full screen and be hidden.
- [ ] **Stage Manager strip**: with Stage Manager on, lock. After a second, the strip should not show your Brave windows (they are minimized to the Dock). Tell me if any live thumbnail of page content is still visible.
- [ ] **Strict mode** (Settings, While locked, Hide windows completely; macOS only, and Brave will refuse it): lock, check nothing is in the strip, Dock or Mission Control, unlock, and check every window and tab came back.
- [ ] **Lock window in full screen** (Settings, "Lock window in full screen"): lock and unlock. Note any jump.

## Automatic locking (the machine, not the browser)
- [ ] **Screen lock** (Control+Command+Q): unlock your Mac, and Brave should be locked.
- [ ] **Sleep or closing the lid**: wake the Mac, and Brave should be locked (needs "When the screen locks or the Mac sleeps" on).
- [ ] **Inactivity**: set 1 minute, leave the keyboard and mouse alone, watch it lock.
- [ ] **Brave in the background**: set "In the background" to 1 minute, switch to another app, come back after 70 seconds.
- [ ] **Quit and reopen Brave** with "When the browser starts" on: it opens locked.

## Touch ID and recovery (real hardware)
- [ ] Set up Touch ID in Settings, lock, unlock with a fingerprint.
- [ ] Cancel the Touch ID prompt: you can still type the passcode.
- [ ] Forgot passcode: use the recovery code, then confirm the new code.

## Other systems and browsers
- [ ] **Brave, Chrome and Edge** on the versions you use. Load unpacked and run the checks above that apply.
- [ ] **Windows and Linux**: maximize, snap to half screen, minimize, lock, unlock. Full screen here is F11.
- [ ] **Private windows**: allow Latch in private windows, open one, lock, unlock.
- [ ] **Two Brave profiles**: install Latch in one only. Locking it must not touch the other profile's windows.

## The Mac helper (Native Mac helper style)
- [ ] **Install**: double-click `Install Latch Helper.command` in the Latch folder. A dialog says it is installed. In Latch settings, How Latch locks, the card changes to *Helper found* on its own, with no reload.
- [ ] **Where is the folder?** In settings, step 1 opens Latch in your extensions; click the path next to *Source* and Finder shows the folder.
- [ ] **Lock a normal window, a maximized one and a full-screen one** (green button): a lock sits exactly over each, tab strip and address bar included. Nothing resizes, moves, minimizes or leaves full screen. No extra window opens.
- [ ] **Type the passcode**: the field has the keyboard at once. A wrong one shakes and says so; the right one removes the lock.
- [ ] **Switch away and back while locked** (Cmd+Tab to another app and back, or switch Spaces): typing must never reach the browser behind the lock.
- [ ] **Touch ID** (turn it on in settings first): press the fingerprint button, or Return on an empty field. Try a wrong finger and the passcode too.
- [ ] **Stage Manager**: with it on, lock. Report what the side strip shows for your Brave windows.
- [ ] **Two displays**: lock with a window on each. Both are covered.
- [ ] **Moved the folder**: move the Latch folder, reload Latch in `brave://extensions`. Settings say the helper is installed for another folder; double-click the installer again.
- [ ] **Remove it**: double-click `Uninstall Latch Helper.command`. Latch locks on the page again and says so in Activity.
- [ ] **First run on a Mac**: after the private-windows step, onboarding offers the helper ("Make it feel native"). Skip it, lock once: the toolbar popup then says *Locked on the page only. Get the Mac helper for a native lock*, and clicking it opens settings at How Latch locks. Install the helper and the note goes away.
