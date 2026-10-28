#!/bin/sh
# Builds the Latch helper (needs the Xcode command line tools: xcode-select --install).
#   sh native/build.sh          a universal build (Apple Silicon and Intel) into native/bin/, the one install.sh uses
#   sh native/build.sh --fast   this Mac's architecture only, into native/build/ (for tests)
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
SRC="$HERE/helper/main.swift"
FLAGS="-O -swift-version 5 -framework Cocoa -framework LocalAuthentication"
if [ "${1:-}" = "--fast" ]; then
  mkdir -p "$HERE/build"
  swiftc $FLAGS -o "$HERE/build/latch-helper" "$SRC"
  echo "built $HERE/build/latch-helper"
  exit 0
fi
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
swiftc $FLAGS -target arm64-apple-macos12.0 -o "$TMP/arm64" "$SRC"
swiftc $FLAGS -target x86_64-apple-macos12.0 -o "$TMP/x86_64" "$SRC"
mkdir -p "$HERE/bin"
lipo -create "$TMP/arm64" "$TMP/x86_64" -output "$HERE/bin/latch-helper"
codesign -s - --force "$HERE/bin/latch-helper"
echo "built $HERE/bin/latch-helper (arm64 + x86_64)"
