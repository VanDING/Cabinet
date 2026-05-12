import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createConnection, closeConnection, getConnection } from '../connection';
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';

const TEST_DB_PATH = join(tmpdir(), `cabinet-storage-test-${Date.now()}.db`);

describe('connection', () => {
  beforeAll(() => {
    createConnection(TEST_DB_PATH);
  });

  afterAll(() => {
    closeConnection();
    try { unlinkSync(TEST_DB_PATH); } catch { /* ignore */ }
    try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ignore */ }
    try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ignore */ }
  });

  it('returns a Database instance', () => {
    const db = getConnection();
    expect(db).toBeInstanceOf(Database);
  });

  it('is in WAL mode', () => {
    const db = getConnection();
    const result = db.pragma('journal_mode') as Array<{ journal_mode: string }>;
    expect(result[0]!.journal_mode).toBe('wal');
  });

  it('has foreign keys enabled', () => {
    const db = getConnection();
    const result = db.pragma('foreign_keys') as Array<{ foreign_keys: number }>;
    expect(result[0]!.foreign_keys).toBe(1);
  });

  it('can create a table and insert data', () => {
    const db = getConnection();
    db.exec('CREATE TABLE IF NOT EXISTS _test (id TEXT PRIMARY KEY, value TEXT)');
    db.prepare('INSERT INTO _test (id, value) VALUES (?, ?)').run('1', 'hello');
    const row = db.prepare('SELECT value FROM _test WHERE id = ?').get('1') as { value: string };
    expect(row.value).toBe('hello');
    db.exec('DROP TABLE _test');
  });

  it('returns the same connection on repeated calls', () => {
    const db1 = getConnection();
    const db2 = getConnection();
    expect(db1).toBe(db2);
  });
});
