from __future__ import annotations

import base64
import logging
import os
import re

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


logger = logging.getLogger(__name__)


class KeyVault:
    PREFIX = "vault:"

    def __init__(
        self,
        enabled: bool = True,
        encryption_key: bytes | None = None,
        key_file: str | None = None,
    ):
        self._enabled = enabled
        if not enabled:
            self._fernet = None
            return
        if encryption_key is not None:
            derived = self._derive_key(encryption_key)
        elif key_file and os.path.exists(key_file):
            with open(key_file, "rb") as f:
                derived = f.read()
            if len(derived) != 44:
                derived = self._derive_key(derived)
        else:
            derived = Fernet.generate_key()
            if key_file:
                os.makedirs(os.path.dirname(key_file) or ".", exist_ok=True)
                with open(key_file, "wb") as f:
                    f.write(derived)
                self._protect_key_file(key_file)
        self._fernet = Fernet(derived)

    @staticmethod
    def _protect_key_file(path: str) -> None:
        try:
            os.chmod(path, 0o600)
        except OSError:
            logger.warning("Could not set permissions on key file: %s", path)

    @staticmethod
    def _derive_key(material: bytes, salt: bytes | None = None) -> bytes:
        if len(material) == 44:
            try:
                base64.urlsafe_b64decode(material)
                return material
            except Exception:
                pass
        if salt is None:
            import hashlib
            salt = hashlib.sha256(material).digest()[:16]
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=480_000,
        )
        return base64.urlsafe_b64encode(kdf.derive(material))

    def encrypt(self, plaintext: str) -> str:
        if not self._enabled:
            return plaintext
        salt = os.urandom(16)
        salt_b64 = base64.urlsafe_b64encode(salt).decode()
        ciphertext = self._fernet.encrypt(plaintext.encode()).decode()
        return f"{self.PREFIX}{salt_b64}${ciphertext}"

    def decrypt(self, token: str) -> str:
        if not self._enabled:
            return token
        if token.startswith(self.PREFIX):
            remainder = token[len(self.PREFIX):]
            if "$" in remainder:
                _, ciphertext = remainder.split("$", 1)
            else:
                ciphertext = remainder
        else:
            ciphertext = token
        return self._fernet.decrypt(ciphertext.encode()).decode()

    @staticmethod
    def mask_secret(secret: str) -> str:
        if len(secret) <= 4:
            return "****"
        return secret[:3] + "*" * (len(secret) - 3)


_SCRIPT_PATTERN = re.compile(r"<\s*script[^>]*>.*?<\s*/\s*script\s*>", re.IGNORECASE | re.DOTALL)
_DANGEROUS_TAGS = re.compile(
    r"<\s*/?(script|iframe|embed|object|applet|form|input|textarea|select|button)[^>]*>",
    re.IGNORECASE | re.DOTALL,
)
_DANGEROUS_PROTOCOLS = re.compile(r"(javascript|data|vbscript)\s*:", re.IGNORECASE)
_EVENT_PATTERN = re.compile(r"on\w+\s*=", re.IGNORECASE)
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def sanitize_input(text: str, max_length: int = 10000) -> str:
    text = _CONTROL_CHARS.sub("", text)
    text = _SCRIPT_PATTERN.sub("", text)
    text = _DANGEROUS_TAGS.sub("", text)
    text = _DANGEROUS_PROTOCOLS.sub("", text)
    text = _EVENT_PATTERN.sub("", text)
    if len(text) > max_length:
        text = text[:max_length]
    return text.strip()

