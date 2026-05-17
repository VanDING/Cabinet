import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEYLEN = 32;
const IVLEN = 16;
const TAGLEN = 16;

/**
 * Derive an encryption key from a master password using scrypt.
 * In production, the master password should come from a secure source
 * (environment variable, OS keychain, or hardware security module).
 */
function deriveKey(masterPassword: string, salt: Buffer): Buffer {
  return scryptSync(masterPassword, salt, KEYLEN);
}

/**
 * Encrypt an API key using AES-256-GCM.
 * Returns base64-encoded: salt(32) + iv(16) + tag(16) + ciphertext
 */
export function encryptApiKey(apiKey: string, masterPassword: string): string {
  const salt = randomBytes(32);
  const iv = randomBytes(IVLEN);
  const key = deriveKey(masterPassword, salt);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Pack: salt + iv + tag + ciphertext
  const result = Buffer.concat([salt, iv, tag, encrypted]);
  return result.toString('base64');
}

/**
 * Decrypt an API key that was encrypted with encryptApiKey.
 */
export function decryptApiKey(encryptedBase64: string, masterPassword: string): string {
  const buffer = Buffer.from(encryptedBase64, 'base64');

  const salt = buffer.subarray(0, 32);
  const iv = buffer.subarray(32, 32 + IVLEN);
  const tag = buffer.subarray(32 + IVLEN, 32 + IVLEN + TAGLEN);
  const ciphertext = buffer.subarray(32 + IVLEN + TAGLEN);

  const key = deriveKey(masterPassword, salt);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Generate a random master password for first-time setup.
 */
export function generateMasterPassword(): string {
  return randomBytes(32).toString('hex');
}
