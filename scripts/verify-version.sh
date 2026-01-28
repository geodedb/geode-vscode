#!/bin/bash
# Verify that package.json version matches the latest git tag
#
# This script ensures that the npm package version always matches the git tag.
# Run manually: ./scripts/verify-version.sh
# Runs automatically on: git push (via pre-commit hook)

set -e

# Get the package.json version
PACKAGE_VERSION=$(node -p "require('./package.json').version")

# Get the latest git tag
LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

echo "Checking version consistency..."
echo "  package.json version: ${PACKAGE_VERSION}"

if [ -z "$LATEST_TAG" ]; then
    echo "  Latest git tag:       (none)"
    echo ""
    echo "WARNING: No git tags found."
    echo "Create a tag matching the package version:"
    echo "  git tag v${PACKAGE_VERSION}"
    echo "  git push origin v${PACKAGE_VERSION}"
    echo ""
    # Don't fail - allow initial development without tags
    exit 0
fi

echo "  Latest git tag:       ${LATEST_TAG}"

# Strip 'v' prefix if present for comparison
TAG_VERSION="${LATEST_TAG#v}"

if [ "$PACKAGE_VERSION" != "$TAG_VERSION" ]; then
    echo ""
    echo "ERROR: Version mismatch detected!"
    echo ""
    echo "The package.json version (${PACKAGE_VERSION}) does not match"
    echo "the latest git tag (${LATEST_TAG})."
    echo ""
    echo "To fix this, either:"
    echo ""
    echo "  1. Update package.json to match the existing tag:"
    echo "     npm version ${TAG_VERSION} --no-git-tag-version"
    echo ""
    echo "  2. Create a new tag for the current version:"
    echo "     git tag v${PACKAGE_VERSION}"
    echo "     git push origin v${PACKAGE_VERSION}"
    echo ""
    echo "  3. If releasing a new version, update package.json first:"
    echo "     npm version <major|minor|patch> --no-git-tag-version"
    echo "     git add package.json package-lock.json"
    echo "     git commit -m 'chore: bump version to X.Y.Z'"
    echo "     git tag vX.Y.Z"
    echo "     git push origin main --tags"
    echo ""
    exit 1
fi

echo ""
echo "Version check passed: v${PACKAGE_VERSION}"
exit 0
