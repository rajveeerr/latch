#!/bin/sh
# Builds the Latch helper (needs the Xcode command line tools: xcode-select --install).
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$HERE/build"
swiftc -O -swift-version 5 -o "$HERE/build/latch-helper" "$HERE/helper/main.swift" -framework Cocoa -framework LocalAuthentication
echo "built $HERE/build/latch-helper"
