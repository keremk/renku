#!/bin/bash
set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

BUMP_TYPE="${1:-patch}"

if [[ ! "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo -e "${RED}Error: Invalid bump type '$BUMP_TYPE'${NC}"
  echo "Usage: $0 [patch|minor|major]"
  echo "  patch (default) - bug fixes (0.1.1 -> 0.1.2)"
  echo "  minor           - new features (0.1.1 -> 0.2.0)"
  echo "  major           - breaking changes (0.1.1 -> 1.0.0)"
  exit 1
fi

PACKAGES=("core" "compositions" "providers" "cli" "viewer" "desktop")

get_version() {
  local pkg=$1
  node -p "require('./$pkg/package.json').version"
}

bump_version() {
  local current=$1
  local type=$2
  IFS='.' read -r major minor patch <<< "$current"
  case $type in
    major)
      echo "$((major + 1)).0.0"
      ;;
    minor)
      echo "$major.$((minor + 1)).0"
      ;;
    patch)
      echo "$major.$minor.$((patch + 1))"
      ;;
  esac
}

echo -e "${BLUE}Bumping all package versions: $BUMP_TYPE${NC}"
echo ""

BASE_VERSION="$(get_version "${PACKAGES[0]}")"

for pkg in "${PACKAGES[@]}"; do
  pkg_version="$(get_version "$pkg")"
  if [[ "$pkg_version" != "$BASE_VERSION" ]]; then
    echo -e "${RED}Error: package versions are out of sync.${NC}"
    echo "Expected all packages to match $BASE_VERSION before bumping."
    for item in "${PACKAGES[@]}"; do
      echo "  - $item@$(get_version "$item")"
    done
    exit 1
  fi
done

NEW_VERSION="$(bump_version "$BASE_VERSION" "$BUMP_TYPE")"

for pkg in "${PACKAGES[@]}"; do
  echo -e "${GREEN}Bumping $pkg...${NC}"
  node -e "
    const fs = require('fs');
    const packagePath = './$pkg/package.json';
    const json = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    json.version = '$NEW_VERSION';
    fs.writeFileSync(packagePath, JSON.stringify(json, null, 2) + '\n');
  "
  echo -e "  → $pkg@$NEW_VERSION"
done

echo ""
echo -e "${GREEN}✅ All packages bumped to $NEW_VERSION${NC}"
echo ""
echo "Package versions:"
echo "  - @gorenku/core@$(get_version core)"
echo "  - @gorenku/compositions@$(get_version compositions)"
echo "  - @gorenku/providers@$(get_version providers)"
echo "  - @gorenku/cli@$(get_version cli)"
echo "  - viewer@$(get_version viewer) (private)"
echo "  - renku-desktop@$(get_version desktop) (private)"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  1. Review changes: ${BLUE}git diff */package.json${NC}"
echo -e "  2. Commit: ${BLUE}git add */package.json && git commit -m 'release: v$NEW_VERSION'${NC}"
echo -e "  3. Tag: ${BLUE}git tag v$NEW_VERSION${NC}"
echo -e "  4. Push: ${BLUE}git push origin main v$NEW_VERSION${NC}"
echo ""
echo -e "${YELLOW}Full release flow:${NC}"
echo -e "  ${BLUE}pnpm release:ship${NC}"
