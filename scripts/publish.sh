#!/bin/bash
# Publish Cabinet core packages to npm
set -e

PACKAGES=(
  "packages/types"
  "packages/events"
  "packages/storage"
  "packages/gateway"
  "packages/agent"
  "packages/memory"
  "packages/decision"
  "packages/secretary"
  "packages/workflow"
  "packages/harness"
)

echo "Building all packages..."
pnpm build

for pkg in "${PACKAGES[@]}"; do
  echo "Publishing $pkg..."
  cd "$pkg"
  npm publish --access public
  cd - > /dev/null
done

echo "Done! Published ${#PACKAGES[@]} packages."
