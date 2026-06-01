import { describe, it, expect } from 'vitest';
import { hashPin, verifyPin } from '../auth-utils';

describe('hashPin', () => {
  it('generates scrypt:<salt>:<hash> format', async () => {
    const hash = await hashPin('1234');
    expect(hash).toMatch(/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/);
  });

  it('produces different hashes for the same PIN (random salt)', async () => {
    const h1 = await hashPin('1234');
    const h2 = await hashPin('1234');
    expect(h1).not.toBe(h2);
    // Both should still verify correctly
    expect((await verifyPin('1234', h1)).valid).toBe(true);
    expect((await verifyPin('1234', h2)).valid).toBe(true);
  });

  it('produces different hashes for different PINs', async () => {
    const h1 = await hashPin('1111');
    const h2 = await hashPin('2222');
    expect(h1).not.toBe(h2);
  });
});

describe('verifyPin', () => {
  it('validates correct PIN (new format)', async () => {
    const hash = await hashPin('correct-pin');
    const result = await verifyPin('correct-pin', hash);
    expect(result.valid).toBe(true);
    expect(result.needsRehash).toBe(false);
  });

  it('rejects wrong PIN (new format)', async () => {
    const hash = await hashPin('correct-pin');
    const wrong = await verifyPin('wrong-pin', hash);
    expect(wrong.valid).toBe(false);
  });

  it('validates legacy format and returns needsRehash', async () => {
    // Legacy format: scrypt:<hash> (global hardcoded salt)
    const { scryptSync } = await import('node:crypto');
    const legacyHash = 'scrypt:' + scryptSync('mypin', 'cabinet-salt', 64).toString('hex');
    const result = await verifyPin('mypin', legacyHash);
    expect(result.valid).toBe(true);
    expect(result.needsRehash).toBe(true);
  });

  it('rejects wrong PIN for legacy format', async () => {
    const { scryptSync } = await import('node:crypto');
    const legacyHash = 'scrypt:' + scryptSync('mypin', 'cabinet-salt', 64).toString('hex');
    const result = await verifyPin('wrongpin', legacyHash);
    expect(result.valid).toBe(false);
  });

  it('validates SHA-256 legacy format and returns needsRehash', async () => {
    const { createHash } = await import('node:crypto');
    const legacyHash = createHash('sha256').update('oldpin' + 'cabinet-salt').digest('hex');
    const result = await verifyPin('oldpin', legacyHash);
    expect(result.valid).toBe(true);
    expect(result.needsRehash).toBe(true);
  });

  it('rejects wrong PIN for SHA-256 legacy format', async () => {
    const { createHash } = await import('node:crypto');
    const legacyHash = createHash('sha256').update('oldpin' + 'cabinet-salt').digest('hex');
    const result = await verifyPin('wrong', legacyHash);
    expect(result.valid).toBe(false);
  });

  it('rejects empty input', async () => {
    const hash = await hashPin('1234');
    const result = await verifyPin('', hash);
    expect(result.valid).toBe(false);
  });

  it('handles malformed stored hash gracefully', async () => {
    const result = await verifyPin('1234', 'garbage');
    expect(result.valid).toBe(false);
    expect(result.needsRehash).toBe(false);
  });
});
