#!/bin/sh
# Removes the Latch helper and the files that let browsers start it.
set -eu
SUPPORT="$HOME/Library/Application Support"
for BROWSER in "BraveSoftware/Brave-Browser" "Google/Chrome" "Chromium" "Microsoft Edge"; do
  rm -f "$SUPPORT/$BROWSER/NativeMessagingHosts/com.latch.helper.json"
done
rm -rf "$SUPPORT/Latch"
echo "Latch helper removed."
