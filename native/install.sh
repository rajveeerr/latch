#!/bin/sh
# Installs the Latch helper for the browsers found on this Mac. Run it yourself, from the Latch folder:
#   ./native/install.sh            (an unpacked Latch: the extension id is worked out from this folder)
#   ./native/install.sh <id>       (Latch installed from a store: pass its id)
# It writes only to ~/Library/Application Support (the helper, and one small file per browser saying who may start it).
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd -P)
ID=${1:-}
if [ -z "$ID" ]; then
  # An unpacked extension's id is the SHA-256 of its folder path, written with the letters a-p.
  ID=$(printf %s "$ROOT" | shasum -a 256 | cut -c1-32 | tr '0-9a-f' 'a-p')
fi

# The helper ships prebuilt (Apple Silicon and Intel). Only if it is missing is it built here, which needs the Xcode command line tools.
chmod +x "$HERE/bin/latch-helper" 2>/dev/null || true    # a re-zipped copy can lose the executable bit
[ -x "$HERE/bin/latch-helper" ] || sh "$HERE/build.sh"

DEST="$HOME/Library/Application Support/Latch"
mkdir -p "$DEST"
# Copy beside it and rename over it. Writing into the old file in place can make macOS refuse to run it afterwards, and
# renaming leaves a helper that is running right now untouched.
cp "$HERE/bin/latch-helper" "$DEST/latch-helper.new"
chmod 755 "$DEST/latch-helper.new"
mv -f "$DEST/latch-helper.new" "$DEST/latch-helper"
"$DEST/latch-helper" </dev/null >/dev/null 2>&1 || { echo "  the helper did not start on a test run: see System Settings > Privacy & Security"; }   # start it once: macOS checks a new program on its first launch, so the first lock is not slow

write_manifest() {   # $1 = the browser's NativeMessagingHosts folder
  mkdir -p "$1"
  cat > "$1/com.latch.helper.json" <<JSON
{
  "name": "com.latch.helper",
  "description": "Latch lock screen helper",
  "path": "$DEST/latch-helper",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$ID/"]
}
JSON
  echo "  allowed Latch ($ID) in: $1"
}

SUPPORT="$HOME/Library/Application Support"
if [ -n "${LATCH_HOSTS_DIR:-}" ]; then            # for tests: one folder only
  write_manifest "$LATCH_HOSTS_DIR"
else
  FOUND=0
  for BROWSER in "BraveSoftware/Brave-Browser" "Google/Chrome" "Chromium" "Microsoft Edge"; do
    if [ -d "$SUPPORT/$BROWSER" ]; then write_manifest "$SUPPORT/$BROWSER/NativeMessagingHosts"; FOUND=1; fi
  done
  if [ "$FOUND" != 1 ]; then
    echo "  No supported browser was found (Brave, Chrome, Chromium or Edge in the standard place), so nothing was set up." >&2
    exit 1
  fi
fi
echo "Done. Latch's settings will notice the helper by themselves; there is nothing to reload."
