#!/bin/bash
# One-time setup: create a self-signed code signing certificate for local development.
# Required because macOS blocks custom URL protocol registration for unsigned apps.

set -e

CERT_NAME="CabinetDev"
KEY_FILE="/tmp/cabinet-dev-key.pem"
CERT_FILE="/tmp/cabinet-dev-cert.pem"
P12_FILE="/tmp/cabinet-dev.p12"
P12_PASS="cabinet"

echo "Creating self-signed code signing certificate '$CERT_NAME'..."

# 1. Generate RSA key + self-signed cert with code signing extensions
openssl req -new -x509 -days 365 -nodes \
  -subj "/CN=$CERT_NAME/OU=Development/O=Cabinet" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=codeSigning" \
  -newkey rsa:2048 \
  -keyout "$KEY_FILE" \
  -out "$CERT_FILE" 2>/dev/null

# 2. Bundle into PKCS12
openssl pkcs12 -export \
  -in "$CERT_FILE" \
  -inkey "$KEY_FILE" \
  -out "$P12_FILE" \
  -passout "pass:$P12_PASS" \
  -name "$CERT_NAME" 2>/dev/null

# 3. Remove any previous certificate with same name
security delete-certificate -c "$CERT_NAME" ~/Library/Keychains/login.keychain-db 2>/dev/null || true

# 4. Import into login keychain, allowing codesign access
security import "$P12_FILE" \
  -k ~/Library/Keychains/login.keychain-db \
  -P "$P12_PASS" \
  -T /usr/bin/codesign \
  -T /usr/bin/security \
  -T /usr/bin/productsign \
  -A

# 5. Clean up temp files
rm -f "$KEY_FILE" "$CERT_FILE" "$P12_FILE"

echo ""
echo "Certificate '$CERT_NAME' created and imported."
echo ""

# Verify (codesign may not show it in identities list but will accept it)
if codesign --sign "$CERT_NAME" /bin/ls 2>/dev/null; then
  echo "✓ Signing test passed"
else
  echo "NOTE: Certificate installed but may require keychain trust."
  echo "If codesign fails, open Keychain Access → find '$CERT_NAME' → Get Info → Trust → set 'Code Signing' to 'Always Trust'."
fi
