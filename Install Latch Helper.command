#!/bin/sh
# Double-click this file. It installs the Latch helper (a one-time step) and tells you when it is done.
cd "$(dirname "$0")" || exit 1
if OUT=$(sh native/install.sh 2>&1); then
  printf '%s\n\nAll done. You can close this window.\n' "$OUT"
  [ -n "${LATCH_NO_DIALOG:-}" ] || osascript -e 'display dialog "The Latch helper is installed.\n\nGo back to Latch settings. It says \"Helper found\" by itself, and there is nothing to reload." with title "Latch" buttons {"Done"} default button 1 with icon note' >/dev/null 2>&1
else
  printf '%s\n\nThe helper could not be installed. The lines above say why.\n' "$OUT"
  [ -n "${LATCH_NO_DIALOG:-}" ] || osascript -e 'display dialog "The Latch helper could not be installed. The Terminal window shows why." with title "Latch" buttons {"OK"} default button 1 with icon caution' >/dev/null 2>&1
fi
