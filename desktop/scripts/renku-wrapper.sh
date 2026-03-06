#!/usr/bin/env bash
#
# renku CLI wrapper - installed to /usr/local/bin/renku by Renku.app
#
# This script delegates to the CLI bundled inside the Renku Electron app.
# Requires Node.js on PATH (Claude Code users will have this).
#

set -euo pipefail

APP_CONTENTS="/Applications/Renku.app/Contents"
RESOURCES="$APP_CONTENTS/Resources"
CLI_ENTRY="$RESOURCES/cli/cli.js"

# Check that Renku.app is installed
if [ ! -f "$CLI_ENTRY" ]; then
  echo "Error: Renku.app not found at /Applications/Renku.app" >&2
  echo "Please install Renku from https://gorenku.com or reinstall the application." >&2
  exit 1
fi

# Check that Node.js is available
if ! command -v node &>/dev/null; then
  echo "Error: Node.js is required to run the renku CLI." >&2
  echo "Install Node.js from https://nodejs.org" >&2
  exit 1
fi

# Add bundled ffmpeg to PATH so renku export and other ffmpeg commands work
FFMPEG_DIR="$RESOURCES/app.asar.unpacked/node_modules/ffmpeg-static"
if [ -d "$FFMPEG_DIR" ]; then
  export PATH="$FFMPEG_DIR:$PATH"
fi

# Load user environment (API keys etc.)
ENV_FILE="$HOME/.config/renku/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

# Forward all arguments to the bundled CLI
exec node "$CLI_ENTRY" "$@"
