#!/usr/bin/env bash
set -euo pipefail

# Build and deploy Renku desktop app to Cloudflare R2.
#
# Usage:
#   bash scripts/deploy-desktop.sh --production              # build + upload to stable channel
#   bash scripts/deploy-desktop.sh --internal                # build + upload to dev channel
#   bash scripts/deploy-desktop.sh --internal --skip-build   # upload only (reuse existing build)
#   bash scripts/deploy-desktop.sh --internal --dry-run      # validate everything, skip uploads

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---------------------------------------------------------------------------
# Terminal colors (disabled when output is not a tty)
# ---------------------------------------------------------------------------

if [[ -t 1 ]]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  DIM='\033[0;90m'
  NC='\033[0m'
else
  RED='' GREEN='' DIM='' NC=''
fi

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------

CHANNEL=""
SKIP_BUILD=false
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --production) CHANNEL="production" ;;
    --internal)   CHANNEL="internal" ;;
    --skip-build) SKIP_BUILD=true ;;
    --dry-run)    DRY_RUN=true ;;
    *)
      echo "Error: Unknown argument '$arg'"
      echo "Usage: $0 [--production|--internal] [--skip-build] [--dry-run]"
      exit 1
      ;;
  esac
done

if [[ -z "$CHANNEL" ]]; then
  echo "Error: Must specify --production or --internal"
  echo "Usage: $0 [--production|--internal] [--skip-build] [--dry-run]"
  exit 1
fi

# ---------------------------------------------------------------------------
# Load environment
# ---------------------------------------------------------------------------

if [[ -f "$ROOT_DIR/.env" ]]; then
  # Export only the vars we need, ignoring comments and blank lines
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    case "$key" in
      CLOUDFLARE_TOKEN|CLOUDFLARE_ACCOUNT_ID) export "$key=$value" ;;
    esac
  done < "$ROOT_DIR/.env"
fi

: "${CLOUDFLARE_TOKEN:?Error: CLOUDFLARE_TOKEN not set in .env}"
: "${CLOUDFLARE_ACCOUNT_ID:?Error: CLOUDFLARE_ACCOUNT_ID not set in .env}"

# wrangler reads CLOUDFLARE_API_TOKEN, not CLOUDFLARE_TOKEN
export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_TOKEN"

# ---------------------------------------------------------------------------
# Channel configuration
# ---------------------------------------------------------------------------

BUCKET="renku-downloads"
RELEASE_DIR="$ROOT_DIR/desktop/release"

if [[ "$CHANNEL" == "production" ]]; then
  R2_PREFIX="desktop/stable/darwin/arm64"
  BUILD_CMD="pnpm package:desktop:prod"
  YML_FILE="latest-mac.yml"
else
  R2_PREFIX="desktop/dev/darwin/arm64"
  BUILD_CMD="pnpm package:desktop:dev"
  YML_FILE="dev-mac.yml"
fi

# ---------------------------------------------------------------------------
# Step 1: Verify R2 access
# ---------------------------------------------------------------------------

echo ""
echo "==> Verifying R2 access..."
output=""
if ! output=$(npx wrangler r2 bucket list 2>&1); then
  echo -e "    ${RED}✘${NC} Cannot access R2. Check CLOUDFLARE_TOKEN permissions."
  echo "$output" | sed 's/^/    /'
  exit 1
fi
if ! echo "$output" | grep -q "$BUCKET"; then
  echo -e "    ${RED}✘${NC} Bucket '$BUCKET' not found in account."
  echo "    Available buckets:"
  echo "$output" | sed 's/^/      /'
  exit 1
fi
echo -e "    ${GREEN}✓${NC} Bucket '$BUCKET' accessible."

# ---------------------------------------------------------------------------
# Step 2: Build
# ---------------------------------------------------------------------------

if [[ "$DRY_RUN" == true ]]; then
  echo ""
  echo "==> Dry run — skipping build"
elif [[ "$SKIP_BUILD" == false ]]; then
  echo ""
  echo "==> Building desktop app ($CHANNEL channel)..."
  echo "    Running: $BUILD_CMD"
  echo ""
  cd "$ROOT_DIR"
  $BUILD_CMD
else
  echo ""
  echo "==> Skipping build (--skip-build)"
fi

# ---------------------------------------------------------------------------
# Step 3: Detect version
# ---------------------------------------------------------------------------

DMG=$(find "$RELEASE_DIR" -maxdepth 1 -name "Renku-*-arm64.dmg" ! -name "Renku-latest-*" | head -1)

if [[ -z "$DMG" ]]; then
  echo -e "${RED}Error:${NC} No Renku-*-arm64.dmg found in $RELEASE_DIR"
  exit 1
fi

VERSION=$(basename "$DMG" | sed 's/Renku-\(.*\)-arm64\.dmg/\1/')
echo ""
echo "==> Detected version: $VERSION"

# Validate expected files exist
EXPECTED_FILES=(
  "Renku-${VERSION}-arm64.dmg"
  "Renku-${VERSION}-arm64.dmg.blockmap"
  "Renku-${VERSION}-arm64-mac.zip"
  "Renku-${VERSION}-arm64-mac.zip.blockmap"
  "$YML_FILE"
)

for f in "${EXPECTED_FILES[@]}"; do
  if [[ ! -f "$RELEASE_DIR/$f" ]]; then
    echo -e "    ${RED}✘${NC} Expected file not found: $RELEASE_DIR/$f"
    exit 1
  fi
done

echo -e "    ${GREEN}✓${NC} All expected files present."

# ---------------------------------------------------------------------------
# Step 4: Upload to R2
# ---------------------------------------------------------------------------

UPLOAD_COUNT=0
UPLOAD_FAILED=0

upload() {
  local file="$1"
  local key="$2"
  local size
  size=$(du -h "$file" | cut -f1 | xargs)

  if [[ "$DRY_RUN" == true ]]; then
    echo -e "    ${DIM}$key ($size) — dry run, skipped${NC}"
    return 0
  fi

  printf "    %s (%s) ... " "$key" "$size"

  local output
  if ! output=$(npx wrangler r2 object put "$BUCKET/$key" \
    --file "$file" \
    --remote 2>&1); then
    echo -e "${RED}FAILED${NC}"
    echo ""
    echo -e "    ${RED}✘ Upload failed: $key${NC}"
    echo "    wrangler output:"
    echo "$output" | sed 's/^/      /'
    UPLOAD_FAILED=1
    return 1
  fi

  # Verify wrangler reported success (catches e.g. local-only uploads)
  if ! echo "$output" | grep -q "Upload complete"; then
    echo -e "${RED}FAILED${NC}"
    echo ""
    echo -e "    ${RED}✘ Upload may have failed (no confirmation): $key${NC}"
    echo "    wrangler output:"
    echo "$output" | sed 's/^/      /'
    UPLOAD_FAILED=1
    return 1
  fi

  echo -e "${GREEN}OK${NC}"
  UPLOAD_COUNT=$((UPLOAD_COUNT + 1))
}

echo ""
echo "==> Uploading binaries to R2 ($R2_PREFIX)..."

upload "$RELEASE_DIR/Renku-${VERSION}-arm64.dmg" \
       "$R2_PREFIX/Renku-${VERSION}-arm64.dmg"

upload "$RELEASE_DIR/Renku-${VERSION}-arm64.dmg.blockmap" \
       "$R2_PREFIX/Renku-${VERSION}-arm64.dmg.blockmap"

upload "$RELEASE_DIR/Renku-${VERSION}-arm64-mac.zip" \
       "$R2_PREFIX/Renku-${VERSION}-arm64-mac.zip"

upload "$RELEASE_DIR/Renku-${VERSION}-arm64-mac.zip.blockmap" \
       "$R2_PREFIX/Renku-${VERSION}-arm64-mac.zip.blockmap"

# Production: create stable alias for website download button
if [[ "$CHANNEL" == "production" ]]; then
  echo ""
  echo "==> Creating stable download alias..."
  upload "$RELEASE_DIR/Renku-${VERSION}-arm64.dmg" \
         "$R2_PREFIX/Renku-latest-arm64.dmg"
fi

# Upload metadata LAST so the updater never sees stale references
echo ""
echo "==> Uploading $YML_FILE (last)..."
upload "$RELEASE_DIR/$YML_FILE" "$R2_PREFIX/$YML_FILE"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

echo ""
if [[ "$DRY_RUN" == true ]]; then
  echo -e "==> ${GREEN}Dry run complete${NC} — no files were uploaded."
elif [[ "$UPLOAD_FAILED" -ne 0 ]]; then
  echo -e "==> ${RED}Deploy failed${NC} — some uploads did not succeed."
  exit 1
else
  echo -e "==> ${GREEN}Deploy complete!${NC}"
fi
echo "    Version:  $VERSION"
echo "    Channel:  $CHANNEL"
echo "    Bucket:   $BUCKET"
echo "    Prefix:   $R2_PREFIX"
if [[ "$DRY_RUN" == false ]]; then
  echo "    Uploaded: $UPLOAD_COUNT file(s)"
fi
echo ""
