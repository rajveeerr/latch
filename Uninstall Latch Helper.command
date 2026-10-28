#!/bin/sh
# Double-click this file to remove the Latch helper. Latch keeps working without it, locking on the page.
cd "$(dirname "$0")" || exit 1
if sh native/uninstall.sh; then
  [ -n "${LATCH_NO_DIALOG:-}" ] || osascript -e 'display dialog "The Latch helper was removed." with title "Latch" buttons {"OK"} default button 1 with icon note' >/dev/null 2>&1
else
  [ -n "${LATCH_NO_DIALOG:-}" ] || osascript -e 'display dialog "The Latch helper could not be removed. The Terminal window shows why." with title "Latch" buttons {"OK"} default button 1 with icon caution' >/dev/null 2>&1
fi
