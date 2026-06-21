import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SessionMetricsRepository } from '../repositories/session-metrics-repo.js';
import { runMigration029 } from '../migrations/029_step_events.js';

describe('SessionMetricsRepository + step_events', () => {
  let db: Database.Database;
  let repo: SessionMetricsRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE session_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        project_id TEXT,
        role TEXT,
        model TEXT,
        total_steps INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        total_cost REAL DEFAULT 0,
        tool_calls_total INTEGER DEFAULT 0,
        tool_calls_failed INTEGER DEFAULT 0,
        tool_calls_blocked INTEGER DEFAULT 0,
        duration_ms INTEGER DEFAULT 0,
        success INTEGER DEFAULT 0,
        error_type TEXT,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at TEXT
      );
    `);
    runMigration029(db);
    repo = new SessionMetricsRepository(db);
  });

  it('getToolSequence returns tool calls ordered by step', () => {
    const stmt = db.prepare(
      'INSERT INTO step_events (session_id, step_number, event_type, payload) VALUES (?, ?, ?, ?)',
    );
    stmt.run(
      's1',
      1,
      'tool_call',
      JSON.stringify({ tool_name: 'read_file', args: { path: 'a.ts' } }),
    );
    stmt.run('s1', 1, 'tool_result', JSON.stringify({ tool_name: 'read_file', success: true }));
    stmt.run(
      's1',
      2,
      'tool_call',
      JSON.stringify({ tool_name: 'write_file', args: { path: 'b.ts' } }),
    );

    const seq = repo.getToolSequence('s1');
    expect(seq.length).toBe(3);
    expect(seq[0]!.tool).toBe('read_file');
    expect(seq[1]!.tool).toBe('read_file');
    expect(seq[2]!.tool).toBe('write_file');
  });

  it('getZoneCrossings returns zone changes', () => {
    const stmt = db.prepare(
      'INSERT INTO step_events (session_id, step_number, event_type, payload) VALUES (?, ?, ?, ?)',
    );
    stmt.run('s1', 3, 'zone_crossing', JSON.stringify({ from: 'smart', to: 'warning' }));
    stmt.run('s1', 7, 'zone_crossing', JSON.stringify({ from: 'warning', to: 'critical' }));

    const crossings = repo.getZoneCrossings('s1');
    expect(crossings.length).toBe(2);
    expect(crossings[0]!.from).toBe('smart');
    expect(crossings[1]!.to).toBe('critical');
  });

  it('getUtilizationSeries returns snapshots', () => {
    const stmt = db.prepare(
      'INSERT INTO step_events (session_id, step_number, event_type, payload) VALUES (?, ?, ?, ?)',
    );
    stmt.run('s1', 1, 'zone_snapshot', JSON.stringify({ utilization: 0.3, zone: 'smart' }));
    stmt.run('s1', 2, 'zone_snapshot', JSON.stringify({ utilization: 0.6, zone: 'warning' }));

    const series = repo.getUtilizationSeries('s1');
    expect(series.length).toBe(2);
    expect(series[0]!.utilization).toBe(0.3);
    expect(series[1]!.zone).toBe('warning');
  });

  it('pruneOlderThan cleans step_events too', () => {
    db.prepare(
      "INSERT INTO step_events (session_id, step_number, event_type, timestamp) VALUES (?, ?, ?, datetime('now', '-91 days'))",
    ).run('old', 1, 'tool_call');
    db.prepare(
      "INSERT INTO step_events (session_id, step_number, event_type, timestamp) VALUES (?, ?, ?, datetime('now'))",
    ).run('new', 1, 'tool_call');

    repo.pruneOlderThan(90);
    const rows = db.prepare('SELECT session_id FROM step_events').all() as any[];
    expect(rows.length).toBe(1);
    expect(rows[0]!.session_id).toBe('new');
  });

  it('getPeakUtilizationDistribution groups into bins', () => {
    // Insert a session metric
    db.prepare(
      `INSERT INTO session_metrics (session_id, model, started_at, success) VALUES (?, ?, datetime('now'), 1)`,
    ).run('s1', 'gpt-4o');
    // Insert zone snapshots with different utilization values
    const stmt = db.prepare(
      'INSERT INTO step_events (session_id, step_number, event_type, payload) VALUES (?, ?, ?, ?)',
    );
    stmt.run('s1', 1, 'zone_snapshot', JSON.stringify({ utilization: 0.42 }));

    const dist = repo.getPeakUtilizationDistribution('gpt-4o', 30);
    expect(dist.length).toBeGreaterThan(0);
    expect(dist[0]!).toHaveProperty('utilizationBin');
    expect(dist[0]!).toHaveProperty('count');
    expect(dist[0]!).toHaveProperty('successRate');
  });
});
