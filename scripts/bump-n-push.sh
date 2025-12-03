#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
BUMP_TYPE="patch"
NON_INTERACTIVE=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --non-interactive)
      NON_INTERACTIVE=true
      shift
      ;;
    patch|minor|major)
      BUMP_TYPE=$1
      shift
      ;;
    *)
      echo -e "${RED}Error: Unknown option '$1'${NC}"
      echo "Usage: $0 [patch|minor|major] [--non-interactive]"
      exit 1
      ;;
  esac
done

# Function to prompt for confirmation
confirm() {
  if [ "$NON_INTERACTIVE" = true ]; then
    return 0
  fi

  local prompt="$1"
  local response

  while true; do
    echo -ne "${YELLOW}$prompt${NC} (y/n): "
    read -r response
    case $response in
      [Yy]*)
        return 0
        ;;
      [Nn]*)
        return 1
        ;;
      *)
        echo -e "${RED}Please answer y or n${NC}"
        ;;
    esac
  done
}

echo -e "${BLUE}=== Renku Version Bump & Push ===${NC}"
echo ""

# Step 1: Bump versions
echo -e "${BLUE}Step 1: Bumping versions ($BUMP_TYPE)${NC}"
./scripts/bump-versions.sh "$BUMP_TYPE"
echo ""

# Get CLI version for tagging
CLI_VERSION=$(node -p "require('./cli/package.json').version")
TAG_NAME="cli-v$CLI_VERSION"

# Step 2: Review changes
echo -e "${BLUE}Step 2: Review changes${NC}"
git diff --stat */package.json
echo ""
git diff */package.json
echo ""

if ! confirm "Do you want to commit these changes?"; then
  echo -e "${YELLOW}Aborted. To revert changes:${NC}"
  echo "  ${BLUE}git checkout */package.json${NC}"
  exit 0
fi

# Step 3: Commit
echo ""
echo -e "${BLUE}Step 3: Committing changes${NC}"
git add */package.json
git commit -m "release: bump to $CLI_VERSION"
echo -e "${GREEN}✅ Committed${NC}"
echo ""

# Step 4: Tag
if ! confirm "Create tag '$TAG_NAME'?"; then
  echo -e "${YELLOW}Aborted. Commit was created but not tagged.${NC}"
  echo ""
  echo -e "${YELLOW}Next steps:${NC}"
  echo "  1. Tag: ${BLUE}git tag $TAG_NAME${NC}"
  echo "  2. Push: ${BLUE}git push origin main $TAG_NAME${NC}"
  exit 0
fi

echo ""
echo -e "${BLUE}Step 4: Creating tag${NC}"
git tag "$TAG_NAME"
echo -e "${GREEN}✅ Tagged: $TAG_NAME${NC}"
echo ""

# Step 5: Push
if ! confirm "Push to origin (main + tag)?"; then
  echo -e "${YELLOW}Aborted. Commit and tag are local only.${NC}"
  echo ""
  echo -e "${YELLOW}Next steps:${NC}"
  echo "  1. Push: ${BLUE}git push origin main $TAG_NAME${NC}"
  echo ""
  echo -e "${RED}To undo (before pushing):${NC}"
  echo "  ${BLUE}git tag -d $TAG_NAME${NC}"
  echo "  ${BLUE}git reset --hard HEAD~1${NC}"
  exit 0
fi

echo ""
echo -e "${BLUE}Step 5: Pushing to origin${NC}"
git push origin main "$TAG_NAME"
echo ""

echo -e "${GREEN}🎉 Success!${NC}"
echo ""
echo "Published version: $CLI_VERSION"
echo "Git tag: $TAG_NAME"
echo ""
echo "GitHub Actions will now:"
echo "  1. Verify tag is on main"
echo "  2. Type check all packages"
echo "  3. Verify tag matches version"
echo "  4. Build all packages"
echo "  5. Publish to npm with provenance"
echo "  6. Create GitHub Release"
echo ""
echo "Watch the workflow: ${BLUE}https://github.com/$(git config --get remote.origin.url | sed 's/.*:\(.*\)\.git/\1/')/actions${NC}"
