from __future__ import annotations

import os


def test_keyvault_encrypt_decrypt_roundtrip():
    from cabinet.core.security import KeyVault

    vault = KeyVault()
    plaintext = "my-secret-api-key"
    encrypted = vault.encrypt(plaintext)
    assert encrypted != plaintext
    assert encrypted.startswith("vault:")
    decrypted = vault.decrypt(encrypted)
    assert decrypted == plaintext


def test_keyvault_new_format_has_salt():
    from cabinet.core.security import KeyVault

    vault = KeyVault()
    encrypted = vault.encrypt("test-value")
    assert encrypted.startswith("vault:")
    remainder = encrypted[len("vault:"):]
    assert "$" in remainder
    parts = remainder.split("$", 1)
    assert len(parts) == 2


def test_keyvault_backward_compatible_decrypt():
    from cabinet.core.security import KeyVault

    vault = KeyVault()
    plaintext = "legacy-secret"
    ciphertext = vault._fernet.encrypt(plaintext.encode()).decode()
    old_format = f"vault:{ciphertext}"
    decrypted = vault.decrypt(old_format)
    assert decrypted == plaintext


def test_keyvault_different_salts_produce_different_ciphertexts():
    from cabinet.core.security import KeyVault

    vault = KeyVault()
    encrypted1 = vault.encrypt("same-secret")
    encrypted2 = vault.encrypt("same-secret")
    assert encrypted1 != encrypted2
    assert vault.decrypt(encrypted1) == "same-secret"
    assert vault.decrypt(encrypted2) == "same-secret"


def test_keyvault_with_custom_key():
    from cabinet.core.security import KeyVault

    key = os.urandom(32)
    vault = KeyVault(encryption_key=key)
    plaintext = "another-secret"
    encrypted = vault.encrypt(plaintext)
    decrypted = vault.decrypt(encrypted)
    assert decrypted == plaintext


def test_keyvault_persistence(tmp_path):
    from cabinet.core.security import KeyVault

    key = os.urandom(32)
    vault1 = KeyVault(encryption_key=key, key_file=str(tmp_path / "vault.key"))
    encrypted = vault1.encrypt("persistent-secret")

    vault2 = KeyVault(encryption_key=key, key_file=str(tmp_path / "vault.key"))
    decrypted = vault2.decrypt(encrypted)
    assert decrypted == "persistent-secret"


def test_keyvault_mask_secret():
    from cabinet.core.security import KeyVault

    vault = KeyVault()
    result = vault.mask_secret("sk-1234567890abcdef")
    assert "1234567890abcdef" not in result
    assert "sk-" in result


def test_keyvault_disabled():
    from cabinet.core.security import KeyVault

    vault = KeyVault(enabled=False)
    plaintext = "pass-through"
    encrypted = vault.encrypt(plaintext)
    assert encrypted == plaintext
    decrypted = vault.decrypt(encrypted)
    assert decrypted == plaintext


def test_sanitize_input_removes_script_tags():
    from cabinet.core.security import sanitize_input

    result = sanitize_input('<script>alert("xss")</script>Hello')
    assert "<script>" not in result
    assert "Hello" in result


def test_sanitize_input_truncates_long_input():
    from cabinet.core.security import sanitize_input

    long_input = "a" * 20000
    result = sanitize_input(long_input, max_length=10000)
    assert len(result) <= 10000


def test_sanitize_input_strips_control_chars():
    from cabinet.core.security import sanitize_input

    result = sanitize_input("hello\x00world\x01test")
    assert "\x00" not in result
    assert "\x01" not in result
    assert "hello" in result

