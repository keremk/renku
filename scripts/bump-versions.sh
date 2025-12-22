#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default to patch
BUMP_TYPE="${1:-patch}"

# Validate bump type
if [[ ! "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo -e "${RED}Error: Invalid bump type '$BUMP_TYPE'${NC}"
  echo "Usage: $0 [patch|minor|major]"
  echo "  patch (default) - bug fixes (0.1.1 -> 0.1.2)"
  echo "  minor           - new features (0.1.1 -> 0.2.0)"
  echo "  major           - breaking changes (0.1.1 -> 1.0.0)"
  exit 1
fi

echo -e "${BLUE}Bumping all package versions: $BUMP_TYPE${NC}"
echo ""

# Array of packages to bump (directory names)
PACKAGES=("core" "compositions" "providers" "cli")

# Function to bump version
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

# Bump each package
for pkg in "${PACKAGES[@]}"; do
  echo -e "${GREEN}Bumping $pkg...${NC}"

  CURRENT_VERSION=$(node -p "require('./$pkg/package.json').version")
  NEW_VERSION=$(bump_version "$CURRENT_VERSION" "$BUMP_TYPE")

  # Update version in package.json using node
  node -e "
    const fs = require('fs');
    const path = './$pkg/package.json';
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
    pkg.version = '$NEW_VERSION';
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  "

  echo -e "  → $pkg@$NEW_VERSION"
done

# Get CLI version for reference
CLI_VERSION=$(node -p "require('./cli/package.json').version")

echo ""
echo -e "${GREEN}✅ All packages bumped to $BUMP_TYPE version${NC}"
echo ""
echo "Package versions:"
echo "  - @gorenku/core@$(node -p "require('./core/package.json').version")"
echo "  - @gorenku/compositions@$(node -p "require('./compositions/package.json').version")"
echo "  - @gorenku/providers@$(node -p "require('./providers/package.json').version")"
echo "  - @gorenku/cli@$CLI_VERSION"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  1. Review changes: ${BLUE}git diff */package.json${NC}"
echo -e "  2. Commit: ${BLUE}git add */package.json && git commit -m 'release: bump to $CLI_VERSION'${NC}"
echo -e "  3. Tag: ${BLUE}git tag cli-v$CLI_VERSION${NC}"
echo -e "  4. Push: ${BLUE}git push origin main cli-v$CLI_VERSION${NC}"
echo ""
echo -e "${YELLOW}Or use the automated script:${NC}"
echo -e "  ${BLUE}./scripts/bump-n-push.sh${NC}"
