# Cabinet Code Signing & Auto-Update Guide

## Prerequisites

This project uses Tauri 2's built-in updater with pubkey signature verification.

## 1. Generate signing key pair

```bash
cd apps/desktop
pnpm tauri signer generate -- -p cabinet-signing-key
```

This creates:

- `cabinet-signing-key` — private key (keep secret, never commit)
- `cabinet-signing-key.pub` — public key (goes into `tauri.conf.json`)

## 2. Update tauri.conf.json

Copy the **public key** from `cabinet-signing-key.pub` and replace the placeholder in:

`apps/desktop/src-tauri/tauri.conf.json` → `plugins.updater.pubkey`

Current value: `REPLACE_WITH_GENERATED_PUBLIC_KEY`

## 3. Configure CI (GitHub Actions)

Add these secrets to your GitHub repository (Settings → Secrets → Actions):

| Secret Name                          | Value                                  |
| ------------------------------------ | -------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | Contents of `cabinet-signing-key` file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password you set during key generation |

## 4. Build and publish

Local build with signing:

```bash
# Set env vars first
export TAURI_SIGNING_PRIVATE_KEY="$(cat cabinet-signing-key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="your-password"

pnpm --filter @cabinet/desktop tauri:build
```

CI build: merge to `main` triggers the `release` workflow which builds signed binaries.

## Verification

After building with a valid pubkey:

1. The updater JSON at the configured endpoint will be verified against the public key
2. Clients will only install updates signed with the matching private key
3. Without this, auto-update will fail silently

## Key Management

- **Never commit** the private key file
- **Never share** the private key
- If the key is lost, existing clients **cannot be updated** — a new key means a fresh install
- Back up the keypair to a secure location (1Password, hardware security key)
- Consider rotating keys annually

## Windows-Specific

For full SmartScreen reputation (reduced "untrusted app" warnings), an EV Code Signing Certificate is required (~$300/year). This is separate from the updater signing key and involves additional CI configuration.

## macOS-Specific

Requires an Apple Developer account ($99/year) for notarization. Configured via:

- `APPLE_SIGNING_IDENTITY`
- `APPLE_CERTIFICATE` (base64-encoded .p12)
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_API_KEY` / `APPLE_API_ISSUER`
