import type Database from 'better-sqlite3';

export interface SessionMetricRow {
  id: number;
  session_id: string;
  project_id: string | null;
  role: string | null;
  model: string | null;
  total_steps: number;
  total_tokens: number;
  total_cost: number;
  tool_calls_total: number;
  tool_calls_failed: number;
  tool_calls_blocked: number;
  duration_ms: number;
  success: number;
  error_type: string | null;
  started_at: string;
  ended_at: string | null;
}

export class SessionMetricsRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(metric: Omit<SessionMetricRow, 'id'>): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO session_metrics (session_id, project_id, role, model, total_steps, total_tokens, total_cost, tool_calls_total, tool_calls_failed, tool_calls_blocked, duration_ms, success, error_type, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        metric.session_id, metric.project_id, metric.role, metric.model,
        metric.total_steps, metric.total_tokens, metric.total_cost,
        metric.tool_calls_total, metric.tool_calls_failed, metric.tool_calls_blocked,
        metric.duration_ms, metric.success, metric.error_type,
        metric.started_at, metric.ended_at,
      );
  }

  pruneOlderThan(days: number): void {
    this.db
      .prepare("DELETE FROM session_metrics WHERE started_at < datetime('now', ?)")
      .run(`-${days} days`);
  }

  sumTokensByDate(dateLike: string): number {
    const row = this.db
      .prepare("SELECT SUM(total_tokens) as tokens FROM session_metrics WHERE started_at LIKE ?")
      .get(dateLike) as { tokens: number } | undefined;
    return row?.tokens ?? 0;
  }

  private rowToMetric(row: Record<string, unknown>): SessionMetricRow {
    return {
      id: row.id as number,
      session_id: row.session_id as string,
      project_id: row.project_id as string | null,
      role: row.role as string | null,
      model: row.model as string | null,
      total_steps: row.total_steps as number,
      total_tokens: row.total_tokens as number,
      total_cost: row.total_cost as number,
      tool_calls_total: row.tool_calls_total as number,
      tool_calls_failed: row.tool_calls_failed as number,
      tool_calls_blocked: row.tool_calls_blocked as number,
      duration_ms: row.duration_ms as number,
      success: row.success as number,
      error_type: row.error_type as string | null,
      started_at: row.started_at as string,
      ended_at: row.ended_at as string | null,
    };
  }
}
