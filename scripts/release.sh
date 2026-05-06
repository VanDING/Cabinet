#!/bin/bash
set -euo pipefail

VERSION="${1:?Usage: scripts/release.sh <version>}"

echo "=== Cabinet Release: v${VERSION} ==="

echo "[1/6] Updating version in src/cabinet/__init__.py..."
sed -i "s/^__version__ = .*/__version__ = \"${VERSION}\"/" src/cabinet/__init__.py

echo "[2/6] Updating version in pyproject.toml..."
sed -i "s/^version = .*/version = \"${VERSION}\"/" pyproject.toml

echo "[3/6] Running tests..."
python -m pytest tests/ -q

echo "[4/6] Running lint..."
ruff check src/ tests/

echo "[5/6] Building package..."
python -m build

echo "[6/6] Checking package..."
twine check dist/*

echo ""
echo "=== Release v${VERSION} ready ==="
echo "Files in dist/:"
ls -la dist/
echo ""
echo "To publish to TestPyPI:"
echo "  twine upload --repository testpypi dist/*"
echo ""
echo "To publish to PyPI:"
echo "  twine upload dist/*"
echo ""
echo "Don't forget to:"
echo "  git tag v${VERSION}"
echo "  git push origin v${VERSION}"
