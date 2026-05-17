import { createHash, timingSafeEqual, scryptSync } from 'node:crypto';
import type { Database } from '@cabinet/storage';

const SALT = 'cabinet-salt';
const KEYLEN = 64; // scrypt key length

/** Hash a PIN using scrypt (computationally expensive → brute-force resistant). */
export function hashPin(pin: string): string {
  return 'scrypt:' + scryptSync(pin, SALT, KEYLEN).toString('hex');
}

function hashPinLegacy(pin: string): string {
  return createHash('sha256')
    .update(pin + SALT)
    .digest('hex');
}

/** Verify a PIN against a stored hash. Supports both scrypt and legacy SHA-256. */
export function verifyPin(
  input: string,
  storedHash: string,
): { valid: boolean; needsRehash: boolean } {
  if (storedHash.startsWith('scrypt:')) {
    const expected = storedHash.slice(7);
    try {
      return {
        valid: timingSafeEqual(Buffer.from(hashPin(input).slice(7)), Buffer.from(expected)),
        needsRehash: false,
      };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }
  // Legacy SHA-256 fallback
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
    const row = db
      .prepare("SELECT value FROM metrics WHERE name = 'pin_hash' ORDER BY id DESC LIMIT 1")
      .get() as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

/** Store a new PIN hash in the database. */
export function storePinHash(db: Database, pin: string): void {
  db.prepare("INSERT INTO metrics (name, value, tags) VALUES ('pin_hash', ?, '{}')").run(
    hashPin(pin),
  );
}

export { SALT };
