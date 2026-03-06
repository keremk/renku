#!/usr/bin/env bash
# Generate the macOS desktop app icon from the SVG logo.
# Requires ImageMagick 7+ (`magick`).
#
# Produces a 1024x1024 PNG with a solid white background and the bird
# centered at ~80% of the canvas (Apple HIG recommends content occupy
# ~80% since the squircle mask clips corners).
#
# Usage: bash scripts/generate-desktop-icon.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

INPUT="$REPO_ROOT/web/src/assets/logo.svg"
OUTPUT="$REPO_ROOT/desktop/build/icon.png"

if ! command -v magick &>/dev/null; then
  echo "Error: ImageMagick 7+ (magick) is required but not found." >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT")"

magick \
  -density 300 \
  -background white \
  "$INPUT" \
  -resize 819x819 \
  -gravity center \
  -extent 1024x1024 \
  -strip \
  -define png:color-type=2 \
  "$OUTPUT"

echo "Icon generated: $OUTPUT"
