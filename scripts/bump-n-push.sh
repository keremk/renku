#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "[bump-n-push] Delegating to scripts/release/ship.mjs"
echo "[bump-n-push] For explicit stages use: pnpm release:prepare / pnpm release:publish"

node "$REPO_ROOT/scripts/release/ship.mjs" "$@"
