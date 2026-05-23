import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createConnection, closeConnection, getConnection } from '../connection';
import { runMigration001 } from '../migrations/001_initial';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const EXPECTED_TABLES = [
  'projects',
  'employees',
  'decisions',
  'event_log',
  'skills',
  'agent_roles',
  'settings',
  'workflows',
  'api_keys',
  'audit_log',
  'metrics',
  'schema_migrations',
];

describe('migration 001', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cabinet-test-'));
    createConnection(join(tmpDir, 'test.db'));
  });

  afterAll(() => {
    closeConnection();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates all expected tables', () => {
    runMigration001(getConnection());

    const tables = getConnection()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_test%'",
      )
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name).sort();
    expect(tableNames).toEqual([...EXPECTED_TABLES].sort());
  });

  it('is idempotent — running twice does not error', () => {
    const db = getConnection();
    expect(() => {
      runMigration001(db);
      runMigration001(db);
    }).not.toThrow();
  });

  it('event_log has required columns', () => {
    const db = getConnection();
    const columns = db.pragma('table_info(event_log)') as {
      cid: number;
      name: string;
      type: string;
    }[];
    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain('message_id');
    expect(colNames).toContain('correlation_id');
    expect(colNames).toContain('causation_id');
    expect(colNames).toContain('type');
    expect(colNames).toContain('payload');
    expect(colNames).toContain('timestamp');
  });

  it('decisions has level column', () => {
    const db = getConnection();
    const columns = db.pragma('table_info(decisions)') as {
      cid: number;
      name: string;
    }[];
    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain('level');
    expect(colNames).toContain('status');
  });
});
