#!/bin/bash
# Builds Cowbell and replaces /Applications/Cowbell.app, then relaunches it.
# Usage: npm run install:mac            (build + install)
#        npm run install:mac -- --skip-build   (install the last build)
set -euo pipefail
cd "$(dirname "$0")/.."

APP=target/release/bundle/macos/Cowbell.app
DEST=/Applications/Cowbell.app
BIN="$APP/Contents/MacOS/herdr-gui"

if [ "${1:-}" != "--skip-build" ]; then
  START=$(date +%s)
  npx tauri build --bundles app
  # A zero exit with an old binary is not a build.
  [ "$(stat -f %m "$BIN")" -ge "$START" ] || { echo "build is stale: $BIN" >&2; exit 1; }
fi
[ -x "$BIN" ] || { echo "no build at $APP" >&2; exit 1; }

if pgrep -f "$DEST/Contents/MacOS" >/dev/null; then
  osascript -e 'tell application "Cowbell" to quit' || true
  for _ in $(seq 20); do pgrep -f "$DEST/Contents/MacOS" >/dev/null || break; sleep 0.5; done
  pgrep -f "$DEST/Contents/MacOS" >/dev/null && { echo "Cowbell did not quit" >&2; exit 1; }
fi

rm -rf "$DEST"
ditto "$APP" "$DEST"
touch "$DEST"   # refreshes the Finder icon cache for the bundle
open "$DEST"
echo "installed $(stat -f '%Sm' "$DEST/Contents/MacOS/herdr-gui") -> $DEST"
