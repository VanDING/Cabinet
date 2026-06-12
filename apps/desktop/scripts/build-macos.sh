#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TAURI_DIR="$PROJECT_DIR/src-tauri"
APP_NAME="Cabinet"
BUNDLE_DIR="$TAURI_DIR/target/release/bundle/macos"
APP_PATH="$BUNDLE_DIR/$APP_NAME.app"
RESOURCES_DIR="$APP_PATH/Contents/Resources"
FRONTEND_SRC="$TAURI_DIR/resources/frontend"
DMG_DIR="$TAURI_DIR/target/release/bundle/dmg"
SIGN_ID="CabinetDev"
COPIED_MARKER="$RESOURCES_DIR/.frontend-copied"

export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
export HTTP_PROXY="${HTTP_PROXY:-http://127.0.0.1:7890}"
export HTTPS_PROXY="${HTTPS_PROXY:-http://127.0.0.1:7890}"

# ── 1. Build frontend + server ──────────────────────────────────
echo "==> 1. Building frontend + server..."
cd "$PROJECT_DIR"
pnpm build
pnpm --filter @cabinet/server bundle
node scripts/copy-server.mjs

# ── 2. Build Tauri (skip Rust rebuild if binary unchanged) ─────
echo "==> 2. Building Tauri app..."
cd "$PROJECT_DIR"
pnpm tauri build 2>&1 || true  # DMG step may fail, .app is already created

if [ ! -d "$APP_PATH" ]; then
  echo "ERROR: $APP_NAME.app not created"
  exit 1
fi

# ── 3. Copy frontend into .app (Tauri 2.11.1 frontendDist workaround) ──
echo "==> 3. Copying frontend files into .app bundle..."
if [ ! -f "$COPIED_MARKER" ]; then
  rm -rf "$RESOURCES_DIR/index.html" "$RESOURCES_DIR/assets" 2>/dev/null || true
  for f in "$FRONTEND_SRC"/*; do
    if [ -f "$f" ]; then
      cp "$f" "$RESOURCES_DIR/" && echo "  Copied $(basename "$f")"
    elif [ -d "$f" ]; then
      cp -R "$f" "$RESOURCES_DIR/" && echo "  Copied directory $(basename "$f")"
    fi
  done
  touch "$COPIED_MARKER"
else
  echo "  (already copied)"
fi

# ── 4. Sign the app (required for custom URL protocols on macOS) ──
echo "==> 4. Signing .app..."
if security find-identity -v -p codesigning 2>/dev/null | grep -q "$SIGN_ID"; then
  codesign --deep --force --sign "$SIGN_ID" "$APP_PATH" 2>&1 | tail -1
  echo "  Signed with $SIGN_ID"
else
  echo "  WARNING: Signing identity '$SIGN_ID' not found."
  echo "  Custom URL protocols (tauri://, ipc://) will not work."
  echo "  Run: bash scripts/create-dev-cert.sh"
fi

# ── 5. Create DMG ───────────────────────────────────────────────
echo "==> 5. Creating DMG..."
mkdir -p "$DMG_DIR"
rm -f "$DMG_DIR"/Cabinet*.dmg
if command -v create-dmg &>/dev/null; then
  create-dmg --overwrite --no-code-sign "$APP_PATH" "$DMG_DIR"
  echo "  DMG created"
else
  echo "  SKIPPED: create-dmg not found. Run: npm install -g create-dmg"
fi

echo ""
echo "==> Done!"
echo "  .app: $APP_PATH"
echo "  .dmg: $DMG_DIR/$APP_NAME*.dmg"
