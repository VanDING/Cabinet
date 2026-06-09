import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { StepEventObserver } from '../step-event-observer.js';
import type { AgentExecutionContext } from '../../observer-pipeline.js';

describe('StepEventObserver', () => {
  let db: Database.Database;
  let observer: StepEventObserver;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE step_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        step_number INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        timestamp TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  });

  afterEach(() => {
    observer?.dispose();
    db.close();
  });

  it('records tool_call events', async () => {
    observer = new StepEventObserver('sess-1', { enabled: true }, db);
    const ctx = { stepCount: 5 } as AgentExecutionContext;
    await observer.onToolCall({ id: 'tc1', name: 'read_file', args: { path: 'x.ts' } }, ctx);
    await observer.onToolCall({ id: 'tc2', name: 'write_file', args: { path: 'y.ts' } }, ctx);
    observer.dispose();

    const rows = db.prepare('SELECT * FROM step_events WHERE session_id = ?').all('sess-1') as any[];
    expect(rows.length).toBe(2);
    expect(rows[0]!.event_type).toBe('tool_call');
    expect(JSON.parse(rows[0]!.payload).tool_name).toBe('read_file');
  });

  it('records tool_result with success flag', async () => {
    observer = new StepEventObserver('sess-1', { enabled: true }, db);
    const ctx = { stepCount: 3 } as AgentExecutionContext;
    await observer.onToolResult({ id: 'tc1', name: 'read_file', args: {} }, 'file content', ctx);
    await observer.onToolResult({ id: 'tc2', name: 'exec', args: {} }, new Error('fail'), ctx);
    observer.dispose();

    const rows = db.prepare("SELECT * FROM step_events WHERE event_type = 'tool_result'").all() as any[];
    expect(rows.length).toBe(2);
    expect(JSON.parse(rows[0]!.payload).success).toBe(true);
    expect(JSON.parse(rows[1]!.payload).success).toBe(false);
  });

  it('records zone_snapshot onStepEnd', async () => {
    observer = new StepEventObserver('sess-1', { enabled: true }, db);
    const ctx = {
      stepCount: 2,
      lastSnapshot: {
        utilization: 0.55,
        zone: 'warning',
        breakdown: { systemPrompt: 100, messages: 200, toolResults: 50, memory: 0 },
        timestamp: new Date(),
        estimatedTokens: 350,
        maxTokens: 1000,
      },
    } as AgentExecutionContext;
    await observer.onStepEnd(ctx);
    observer.dispose();

    const row = db.prepare("SELECT * FROM step_events WHERE event_type = 'zone_snapshot'").get() as any;
    expect(row).toBeTruthy();
    const payload = JSON.parse(row.payload);
    expect(payload.utilization).toBe(0.55);
    expect(payload.zone).toBe('warning');
  });

  it('batches events and flushes on dispose', async () => {
    observer = new StepEventObserver('sess-1', { enabled: true, batchSize: 5 }, db);
    const ctx = { stepCount: 1 } as AgentExecutionContext;
    for (let i = 0; i < 3; i++) {
      await observer.onToolCall({ id: `t${i}`, name: 'read_file', args: {} }, ctx);
    }
    // Should not have flushed yet (3 < 5)
    let count = db.prepare('SELECT COUNT(*) as c FROM step_events').get() as { c: number };
    expect(count.c).toBe(0);

    observer.dispose();
    count = db.prepare('SELECT COUNT(*) as c FROM step_events').get() as { c: number };
    expect(count.c).toBe(3);
  });

  it('is no-op when disabled or no db', async () => {
    observer = new StepEventObserver('sess-1', { enabled: false });
    const ctx = { stepCount: 1 } as AgentExecutionContext;
    await observer.onToolCall({ id: 't', name: 'read_file', args: {} }, ctx);
    // No crash
    expect(true).toBe(true);
  });
});
