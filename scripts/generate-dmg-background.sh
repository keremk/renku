#!/usr/bin/env bash
# Generate DMG background images for the Renku desktop installer.
# Requires ImageMagick 7+ (magick).
#
# Creates a dark background with pill instruction text, icon area overlay,
# and chevron arrows. Outputs both 1x and @2x PNGs.
#
# The icon positions must match electron-builder.yml contents:
#   App icon:     (190, 255) at 1x  →  (380, 510) at 2x
#   Applications: (470, 255) at 1x  →  (940, 510) at 2x
#
# Usage: bash scripts/generate-dmg-background.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$REPO_ROOT/desktop/build"

# ---- Configurable colors ----
BG_COLOR="#3A3A3A"          # Overall background
PANEL_COLOR="#4C4C4C"       # Icon area and pill background
BORDER_COLOR="#5A5A5A"      # Subtle border on panels
TEXT_COLOR="#E0E0E0"        # Instruction text
ARROW_COLOR="#999999"       # Chevron arrows
# ------------------------------

if ! command -v magick &>/dev/null; then
  echo "Error: ImageMagick 7+ (magick) is required." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

# All coordinates at @2x (1320x880) for a 660x440 window
W=1320
H=880

magick -size "${W}x${H}" "xc:${BG_COLOR}" \
  -fill "${PANEL_COLOR}" -stroke "${BORDER_COLOR}" -strokewidth 1.5 \
  -draw "roundrectangle 90,250 1230,750 28,28" \
  -draw "roundrectangle 360,88 960,164 38,38" \
  -fill "${TEXT_COLOR}" -stroke none \
  -font Helvetica -pointsize 28 -gravity north \
  -annotate +0+114 "Drag to Applications to install" \
  -fill none -stroke "${ARROW_COLOR}" -strokewidth 7 \
  -draw "polyline 580,470 620,510 580,550" \
  -draw "polyline 640,470 680,510 640,550" \
  -draw "polyline 700,470 740,510 700,550" \
  -strip "${OUTPUT_DIR}/background@2x.png"

magick "${OUTPUT_DIR}/background@2x.png" -resize 660x440 "${OUTPUT_DIR}/background.png"

echo "DMG backgrounds generated:"
echo "  ${OUTPUT_DIR}/background.png (660x440)"
echo "  ${OUTPUT_DIR}/background@2x.png (1320x880)"
