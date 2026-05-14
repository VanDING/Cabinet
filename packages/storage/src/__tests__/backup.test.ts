import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BackupManager } from '../backup';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';

describe('BackupManager', () => {
  let tmpDir: string;
  let dbPath: string;
  let backupDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cabinet-backup-'));
    dbPath = join(tmpDir, 'test.db');
    backupDir = join(tmpDir, 'backups');

    // Create a test database with data
    const db = new Database(dbPath);
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)');
    db.prepare('INSERT INTO test (value) VALUES (?)').run('hello');
    db.close();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a backup file', async () => {
    const manager = new BackupManager({ dbPath, backupDir, keepCount: 3 });
    const path = await manager.backup();
    expect(path).toContain('cabinet_backup_');
    expect(path).toContain('.db');
  });

  it('lists backups after creating one', async () => {
    const manager = new BackupManager({ dbPath, backupDir, keepCount: 3 });
    await manager.backup();
    const backups = manager.listBackups();
    expect(backups.length).toBeGreaterThanOrEqual(1);
    expect(backups[0]!.size).toBeGreaterThan(0);
  });

  it('rotates old backups', async () => {
    const manager = new BackupManager({ dbPath, backupDir, keepCount: 2 });
    await manager.backup();
    await manager.backup();
    await manager.backup();
    const backups = manager.listBackups();
    expect(backups.length).toBeLessThanOrEqual(2);
  });

  it('restores from backup', async () => {
    const manager = new BackupManager({ dbPath, backupDir });
    const backupPath = await manager.backup();

    // Modify the original
    const db = new Database(dbPath);
    db.exec("DELETE FROM test WHERE value = 'hello'");
    db.close();

    // Restore
    await manager.restore(backupPath);

    // Verify data is back
    const restored = new Database(dbPath);
    const row = restored.prepare('SELECT value FROM test').get() as any;
    expect(row.value).toBe('hello');
    restored.close();
  });
});
