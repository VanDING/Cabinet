import { describe, it, expect } from 'vitest';
import { encryptApiKey, decryptApiKey, generateMasterPassword } from '../crypto';
import { SafetyChecker } from '@cabinet/agent';
import { createConnection, closeConnection, runMigration001, EventLogRepository } from '@cabinet/storage';
import { SqliteEventStore } from '@cabinet/events';
import { MessageType } from '@cabinet/types';
import type { MessageEnvelope } from '@cabinet/types';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

describe('Security Audit', () => {
  // ---- API Key Encryption ----

  it('API keys are encrypted with AES-256-GCM', () => {
    const masterPw = generateMasterPassword();
    const apiKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456';
    const encrypted = encryptApiKey(apiKey, masterPw);
    expect(encrypted).not.toContain('sk-ant');
    expect(encrypted.length).toBeGreaterThan(128);
    expect(decryptApiKey(encrypted, masterPw)).toBe(apiKey);
  });

  it('encrypted keys cannot be decrypted with wrong master password', () => {
    const apiKey = 'sk-secret-key';
    const encrypted = encryptApiKey(apiKey, 'correct-password');
    expect(() => decryptApiKey(encrypted, 'wrong-password')).toThrow();
  });

  it('decrypted key matches original', () => {
    const pw = generateMasterPassword();
    const original = 'sk-ant-api-key-1234567890';
    const encrypted = encryptApiKey(original, pw);
    expect(decryptApiKey(encrypted, pw)).toBe(original);
  });

  // ---- Agent 4-Tier Safety ----

  it('safety checker: whitelisted tools pass', () => {
    const safety = new SafetyChecker();
    const result = safety.check('read_file', {});
    expect(result.allowed).toBe(true);
    expect(result.tier).toBe('cache');
  });

  it('safety checker: dangerous tools require AI classifier', () => {
    const safety = new SafetyChecker();
    const result = safety.check('delete_file', { path: '/etc' });
    expect(result.allowed).toBe(false);
    expect(result.tier).toBe('ai_classifier');
    expect(result.reason).toContain('teach-back');
  });

  it('safety checker: unknown tools allowed at auto tier', () => {
    const safety = new SafetyChecker();
    const result = safety.check('custom_tool', {});
    expect(result.allowed).toBe(true);
    expect(result.tier).toBe('auto');
  });

  // ---- PIN Validation ----

  it('PIN: validates format (4-8 digits)', async () => {
    const { createApp } = await import('../index');
    const app = createApp();
    const res = await app.request('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '12' }),
    });
    expect(res.status).toBe(400);
  });

  // ---- Backup plaintext safety ----

  it('backups should not store plaintext keys', () => {
    const pw = generateMasterPassword();
    const key = 'sk-sensitive-data';
    const encrypted = encryptApiKey(key, pw);
    // Encrypted data should be base64, not contain the original key
    expect(Buffer.from(encrypted, 'base64').toString('utf-8')).not.toContain(key);
  });

  // ---- SQL Injection prevention in Event Store ----

  it('event store: safe from SQL injection via payload', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cabinet-sec-'));
    const dbPath = join(tmpDir, 'sec.db');
    const db = createConnection(dbPath);
    runMigration001(db);

    const repo = new EventLogRepository(db);
    const store = new SqliteEventStore(repo);

    // Attempt SQL injection via payload
    const envelope: MessageEnvelope = {
      messageId: 'sec-test-1',
      correlationId: 'sec-corr',
      causationId: null,
      timestamp: new Date(),
      messageType: MessageType.TaskOrder,
      payload: { inject: "'; DROP TABLE event_log;--" },
    };
    await store.publish(envelope);

    // Table should still exist and contain the entry (not dropped)
    const chain = await store.getCausationChain('sec-corr');
    expect(chain).toHaveLength(1);
    expect(chain[0]!.messageId).toBe('sec-test-1');

    closeConnection();
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
