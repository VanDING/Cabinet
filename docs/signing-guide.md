# Cabinet Code Signing Guide

## Windows (Tauri)

### 1. Generate signing key pair
npm run tauri signer generate -- -p cabinet-signing-key

### 2. Set environment variables
- TAURI_SIGNING_PRIVATE_KEY: contents of the generated private key file
- TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password used during generation

### 3. Configure GitHub Actions
Add the following secrets to your GitHub repository:
- TAURI_PRIVATE_KEY
- TAURI_KEY_PASSWORD

### 4. Build signed binaries
pnpm tauri:build

### Verification
After building, Windows SmartScreen warnings will be reduced.
Full reputation requires an EV Code Signing Certificate (~$300/year).

## macOS
Requires Apple Developer account ($99/year) for notarization.
