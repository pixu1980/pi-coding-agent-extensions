#!/usr/bin/env bash
set -euo pipefail

# Release script for @pixu1980/pi-path-picker
# Bumps semver based on conventional commits, tags, and publishes to npm

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Release: @pixu1980/pi-path-picker ==="

# Dry-run mode?
if [ "${1:-}" = "--dry-run" ] || [ "${1:-}" = "-n" ]; then
  echo "[dry-run] mode - no changes will be made"
  npx standard-version --dry-run
  echo ""
  echo "[dry-run] would run: npm publish"
  exit 0
fi

# Ensure working tree is clean
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: Working tree has uncommitted changes. Commit or stash first."
  exit 1
fi

# Bump version, tag, update CHANGELOG
npx standard-version --no-verify

# Push tags (always to main for monorepo releases)
echo ""
echo "=== Pushing tags ==="
git push --follow-tags origin main

# Publish to npm
echo ""
echo "=== Publishing to npm ==="
npm publish

echo ""
echo "✓ Released $(node -e "console.log(require('./package.json').version)")"
