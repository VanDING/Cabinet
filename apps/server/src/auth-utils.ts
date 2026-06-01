import { createHash, timingSafeEqual, scrypt, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { MetricRepository } from '@cabinet/storage';
import type { Database } from '@cabinet/storage';

const scryptAsync = promisify(scrypt);
const KEYLEN = 64;

/** Hash a PIN with per-PIN random salt. Format: scrypt:<salt_hex>:<hash_hex> */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scryptAsync(pin, salt, KEYLEN) as Buffer).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function hashPinLegacy(pin: string): string {
  return createHash('sha256')
    .update(pin + 'cabinet-salt')
    .digest('hex');
}

/** Verify a PIN against a stored hash. Supports new scrypt, legacy scrypt, and SHA-256. */
export async function verifyPin(
  input: string,
  storedHash: string,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (storedHash.startsWith('scrypt:')) {
    const parts = storedHash.slice(7).split(':');
    if (parts.length === 2) {
      // New format: scrypt:<salt>:<hash>
      const [salt, expectedHash] = parts;
      try {
        const computed = (await scryptAsync(input, salt!, KEYLEN) as Buffer).toString('hex');
        return {
          valid: timingSafeEqual(Buffer.from(computed), Buffer.from(expectedHash!)),
          needsRehash: false,
        };
      } catch {
        return { valid: false, needsRehash: false };
      }
    }
    // Legacy format: scrypt:<hash> (global hardcoded salt) — needs migration
    const expected = storedHash.slice(7);
    try {
      const legacyHash = (await scryptAsync(input, 'cabinet-salt', KEYLEN) as Buffer).toString('hex');
      const valid = timingSafeEqual(Buffer.from(legacyHash), Buffer.from(expected));
      return { valid, needsRehash: valid };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }
  // Legacy SHA-256 fallback (synchronous — SHA-256 is fast)
  const legacyHash = hashPinLegacy(input);
  try {
    const valid = timingSafeEqual(Buffer.from(legacyHash), Buffer.from(storedHash));
    return { valid, needsRehash: valid };
  } catch {
    return { valid: false, needsRehash: false };
  }
}

/** Read the stored PIN hash from DB. Returns null if not set (first run). */
export function getStoredHash(db: Database): string | null {
  try {
    return new MetricRepository(db).getLatestValue('pin_hash');
  } catch {
    return null;
  }
}

/** Store a new PIN hash in the database. */
export async function storePinHash(db: Database, pin: string): Promise<void> {
  new MetricRepository(db).insert('pin_hash', await hashPin(pin), {});
}
