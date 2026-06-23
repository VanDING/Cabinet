import { describe, it, expect } from 'vitest';
import { createApp } from '../../apps/server/src/index';
import {
  createConnection,
  closeConnection,
  runMigration001,
  BackupManager,
  EventLogRepository,
} from '@cabinet/storage';
import { MessageType } from '@cabinet/types';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const h = { 'Content-Type': 'application/json' };

describe('Performance Benchmarks', () => {
  const app = createApp();

  // Decision approval < 500ms
  it('decision approval latency < 500ms', async () => {
    const start = performance.now();
    const res = await app.request('/api/decisions/test-perf/approve', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ chosenOptionId: 'opt-1' }),
    });
    const elapsed = performance.now() - start;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(500);
  }, 10000);

  // Dashboard loading < 1s
  it('dashboard summary latency < 1000ms', async () => {
    const start = performance.now();
    const res = await app.request('/api/dashboard/summary', { headers: h });
    const elapsed = performance.now() - start;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(1000);
  }, 10000);

  // Backup < 5s for moderate-size DB
  it('backup completes in reasonable time', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cabinet-perf-'));
    const dbPath = join(tmpDir, 'perf.db');
    const backupDir = join(tmpDir, 'backups');

    const db = createConnection(dbPath);
    runMigration001(db);

    // Insert some data
    const insert = db.prepare(
      "INSERT INTO event_log (message_id, correlation_id, type, payload, timestamp) VALUES (?, ?, 'task_order', '{}', datetime('now'))",
    );
    for (let i = 0; i < 1000; i++) {
      insert.run(`perf_msg_${i}`, 'perf-corr');
    }

    const manager = new BackupManager({ dbPath, backupDir, keepCount: 3 });
    const start = performance.now();
    await manager.backup();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5000);
    closeConnection();
    rmSync(tmpDir, { recursive: true, force: true });
  }, 30000);
});
