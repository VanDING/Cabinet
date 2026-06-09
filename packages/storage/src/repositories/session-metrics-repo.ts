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

export interface ZonePerformanceQuery {
  model: string;
  role?: string;
  timeWindowDays: number;
}

export interface ZonePerformanceRow {
  zone: 'smart' | 'warning' | 'critical' | 'dumb';
  sessionCount: number;
  avgSuccessRate: number;
  avgToolErrorRate: number;
  avgFormatFailureRate: number;
  avgStepCount: number;
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
        metric.session_id,
        metric.project_id,
        metric.role,
        metric.model,
        metric.total_steps,
        metric.total_tokens,
        metric.total_cost,
        metric.tool_calls_total,
        metric.tool_calls_failed,
        metric.tool_calls_blocked,
        metric.duration_ms,
        metric.success,
        metric.error_type,
        metric.started_at,
        metric.ended_at,
      );
  }

  pruneOlderThan(days: number): void {
    this.db
      .prepare("DELETE FROM session_metrics WHERE started_at < datetime('now', ?)")
      .run(`-${days} days`);
    // Also prune step_events within the same retention window
    this.db
      .prepare("DELETE FROM step_events WHERE timestamp < datetime('now', ?)")
      .run(`-${days} days`);
  }

  sumTokensByDate(dateLike: string): number {
    const row = this.db
      .prepare('SELECT SUM(total_tokens) as tokens FROM session_metrics WHERE started_at LIKE ?')
      .get(dateLike) as { tokens: number } | undefined;
    return row?.tokens ?? 0;
  }

  // ── Step-event queries (requires 029_step_events migration) ──

  /** Aggregate session quality metrics by peak zone reached. */
  getZonePerformance(query: ZonePerformanceQuery): ZonePerformanceRow[] {
    const { model, role, timeWindowDays } = query;
    const timeFilter = timeWindowDays
      ? `AND sm.started_at >= datetime('now', '-${timeWindowDays} days')`
      : '';
    const roleFilter = role ? 'AND sm.role = ?' : '';

    // Peak zone = highest zone reached in a session (inferred from zone_crossing events)
    // Falls back to 'smart' when no crossings recorded.
    const sql = `
      WITH peak_zones AS (
        SELECT
          sm.session_id,
          COALESCE(
            (SELECT json_extract(se.payload, '$.to')
             FROM step_events se
             WHERE se.session_id = sm.session_id AND se.event_type = 'zone_crossing'
             ORDER BY se.step_number DESC
             LIMIT 1),
            'smart'
          ) AS peak_zone
        FROM session_metrics sm
        WHERE sm.model = ? ${timeFilter} ${roleFilter}
      )
      SELECT
        peak_zone AS zone,
        COUNT(*) AS sessionCount,
        AVG(CASE WHEN sm.success = 1 THEN 1.0 ELSE 0.0 END) AS avgSuccessRate,
        AVG(CASE WHEN sm.tool_calls_failed > 0 THEN 1.0 ELSE 0.0 END) AS avgToolErrorRate,
        0.0 AS avgFormatFailureRate,
        AVG(sm.total_steps) AS avgStepCount
      FROM peak_zones pz
      JOIN session_metrics sm ON sm.session_id = pz.session_id
      GROUP BY peak_zone
    `;

    const params = role ? [model, role] : [model];
    return this.db.prepare(sql).all(...params) as ZonePerformanceRow[];
  }

  /** Distribution of peak utilization vs success rate. */
  getPeakUtilizationDistribution(
    model: string,
    days: number,
  ): { utilizationBin: string; count: number; successRate: number }[] {
    const sql = `
      WITH peak_util AS (
        SELECT
          sm.session_id,
          sm.success,
          COALESCE(
            (SELECT MAX(json_extract(se.payload, '$.utilization'))
             FROM step_events se
             WHERE se.session_id = sm.session_id AND se.event_type = 'zone_snapshot'),
            0
          ) AS peak_utilization
        FROM session_metrics sm
        WHERE sm.model = ?
          AND sm.started_at >= datetime('now', '-${days} days')
      )
      SELECT
        printf('%.2f', CAST(ROUND(peak_utilization * 20) AS INTEGER) / 20.0) AS utilizationBin,
        COUNT(*) AS count,
        AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) AS successRate
      FROM peak_util
      GROUP BY ROUND(peak_utilization * 20)
      ORDER BY utilizationBin
    `;
    return this.db.prepare(sql).all(model) as any[];
  }

  /** Tool call sequence for a specific session. */
  getToolSequence(
    sessionId: string,
  ): { step: number; tool: string; args: string; success: boolean }[] {
    return this.db
      .prepare(
        `SELECT step_number as step,
                json_extract(payload, '$.tool_name') as tool,
                json_extract(payload, '$.args') as args,
                json_extract(payload, '$.success') as success
         FROM step_events
         WHERE session_id = ? AND event_type IN ('tool_call', 'tool_result')
         ORDER BY step_number, id`,
      )
      .all(sessionId) as any[];
  }

  /** Zone crossing records for a session. */
  getZoneCrossings(sessionId: string): { step: number; from: string; to: string; at: string }[] {
    return this.db
      .prepare(
        `SELECT step_number as step,
                json_extract(payload, '$.from') as "from",
                json_extract(payload, '$.to') as "to",
                timestamp as at
         FROM step_events
         WHERE session_id = ? AND event_type = 'zone_crossing'
         ORDER BY step_number`,
      )
      .all(sessionId) as any[];
  }

  /** Utilization time-series for a session. */
  getUtilizationSeries(sessionId: string): { step: number; utilization: number; zone: string }[] {
    return this.db
      .prepare(
        `SELECT step_number as step,
                json_extract(payload, '$.utilization') as utilization,
                json_extract(payload, '$.zone') as zone
         FROM step_events
         WHERE session_id = ? AND event_type = 'zone_snapshot'
         ORDER BY step_number`,
      )
      .all(sessionId) as any[];
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
