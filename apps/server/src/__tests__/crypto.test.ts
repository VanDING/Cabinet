import { describe, it, expect } from 'vitest';
import {
  encryptApiKey,
  decryptApiKey,
  generateMasterPassword,
} from '../crypto';

describe('API Key Encryption', () => {
  it('encrypts and decrypts an API key', () => {
    const masterPw = generateMasterPassword();
    const apiKey = 'sk-ant-api-1234567890abcdef';

    const encrypted = encryptApiKey(apiKey, masterPw);
    expect(encrypted).not.toBe(apiKey);
    expect(encrypted.length).toBeGreaterThan(100);

    const decrypted = decryptApiKey(encrypted, masterPw);
    expect(decrypted).toBe(apiKey);
  });

  it('produces different ciphertext for same key (random IV)', () => {
    const masterPw = generateMasterPassword();
    const apiKey = 'test-key';

    const enc1 = encryptApiKey(apiKey, masterPw);
    const enc2 = encryptApiKey(apiKey, masterPw);
    expect(enc1).not.toBe(enc2); // Different salt and IV
  });

  it('generates a 64-char hex master password', () => {
    const pw = generateMasterPassword();
    expect(pw).toHaveLength(64);
  });
});
