#!/usr/bin/env bash
set -euo pipefail

TARGET_VERSION="${1:-0.1.22}"
LEGACY_PATTERN='Select a Movie|Navigate to /movies|movie-id'
CONFIG_DIR="${HOME}/.config/renku"

echo "[1/9] Stop any running Renku viewer and clear runtime state"
if command -v renku >/dev/null 2>&1; then
  renku viewer:stop || true
fi
pkill -f "viewer-bundle/server-dist/bin.js" || true
pkill -f "@gorenku/cli" || true
rm -f "${CONFIG_DIR}/viewer-server.json"

echo "[2/9] Clear bundle override env vars for this shell"
unset RENKU_VIEWER_BUNDLE_ROOT || true
unset RENKU_VIEWER_ROOT || true
unset VITE_RENKU_ROOT || true

echo "[3/9] Remove global CLI install and stale shim"
npm unlink -g @gorenku/cli || true
npm uninstall -g @gorenku/cli || true

PREFIX="$(npm config get prefix)"
GLOBAL_ROOT="$(npm root -g)"

rm -f "${PREFIX}/bin/renku" || true
rm -rf "${GLOBAL_ROOT}/@gorenku/cli" || true

echo "[4/9] Reinstall CLI version ${TARGET_VERSION}"
npm cache verify
npm install -g "@gorenku/cli@${TARGET_VERSION}"

hash -r

echo "[5/9] Resolve active binary and package directory"
if ! command -v renku >/dev/null 2>&1; then
  echo "ERROR: renku command is not on PATH after reinstall"
  exit 1
fi

RENKU_BIN="$(readlink -f "$(command -v renku)")"
CLI_DIR="${GLOBAL_ROOT}/@gorenku/cli"

echo "RENKU_BIN=${RENKU_BIN}"
echo "CLI_DIR=${CLI_DIR}"
renku --version

if [[ ! -d "${CLI_DIR}/viewer-bundle" ]]; then
  echo "ERROR: viewer-bundle missing at ${CLI_DIR}/viewer-bundle"
  exit 1
fi

echo "[6/9] Verify installed bundle does not contain legacy page text"
if grep -R -nE "${LEGACY_PATTERN}" "${CLI_DIR}/viewer-bundle" >/dev/null 2>&1; then
  echo "ERROR: legacy strings found in installed viewer bundle:"
  grep -R -nE "${LEGACY_PATTERN}" "${CLI_DIR}/viewer-bundle" || true
  exit 1
else
  echo "OK: no legacy movie-selector strings found in installed bundle"
fi

echo "[7/9] Launch #1"
renku launch
sleep 3
pgrep -af "viewer-bundle/server-dist/bin.js" || true

echo "[8/9] Launch #2 (should restart cleanly)"
renku launch
sleep 3
pgrep -af "viewer-bundle/server-dist/bin.js" || true

echo "[9/9] Completed"
echo "If UI is still wrong, share steps [5] and [6] output."
