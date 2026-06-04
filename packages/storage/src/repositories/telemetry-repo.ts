//
// TelemetryRepository — persistence for agent runtime telemetry.
//

import type Database from 'better-sqlite3';

export interface TelemetryRow {
  id?: number;
  task_id: string;
  agent_id: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  ttft_ms: number;
  total_ms: number;
  tool_latency_json: string;
  steps: number;
  status: string;
  created_at?: string;
}

export interface AgentStats {
  agent_id: string;
  total_tasks: number;
  completed: number;
  failed: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  avg_ttft_ms: number;
  avg_total_ms: number;
  last_active: string | null;
}

export class TelemetryRepository {
  constructor(private readonly db: Database.Database) {}

  insert(row: TelemetryRow): void {
    this.db.prepare(`
      INSERT INTO agent_telemetry (task_id, agent_id, model, prompt_tokens, completion_tokens,
        ttft_ms, total_ms, tool_latency_json, steps, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      row.task_id, row.agent_id, row.model,
      row.prompt_tokens, row.completion_tokens,
      row.ttft_ms, row.total_ms,
      row.tool_latency_json, row.steps, row.status,
    );
  }

  findByAgent(agentId: string, limit = 50): TelemetryRow[] {
    const rows = this.db.prepare(
      'SELECT * FROM agent_telemetry WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?',
    ).all(agentId, limit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToTelemetry(r));
  }

  findByTask(taskId: string): TelemetryRow | null {
    const row = this.db.prepare(
      'SELECT * FROM agent_telemetry WHERE task_id = ?',
    ).get(taskId) as Record<string, unknown> | undefined;
    return row ? this.rowToTelemetry(row) : null;
  }

  getStats(agentId?: string): AgentStats[] {
    const where = agentId ? 'WHERE agent_id = ?' : '';
    const params = agentId ? [agentId] : [];
    const rows = this.db.prepare(`
      SELECT
        agent_id,
        COUNT(*) as total_tasks,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(prompt_tokens) as total_prompt_tokens,
        SUM(completion_tokens) as total_completion_tokens,
        AVG(ttft_ms) as avg_ttft_ms,
        AVG(total_ms) as avg_total_ms,
        MAX(created_at) as last_active
      FROM agent_telemetry
      ${where}
      GROUP BY agent_id
      ORDER BY last_active DESC
    `).all(...params) as Record<string, unknown>[];
    return rows.map((r) => ({
      agent_id: r.agent_id as string,
      total_tasks: r.total_tasks as number,
      completed: r.completed as number,
      failed: r.failed as number,
      total_prompt_tokens: r.total_prompt_tokens as number,
      total_completion_tokens: r.total_completion_tokens as number,
      avg_ttft_ms: Math.round(r.avg_ttft_ms as number),
      avg_total_ms: Math.round(r.avg_total_ms as number),
      last_active: r.last_active as string | null,
    }));
  }

  private rowToTelemetry(row: Record<string, unknown>): TelemetryRow {
    return {
      id: row.id as number,
      task_id: row.task_id as string,
      agent_id: row.agent_id as string,
      model: row.model as string,
      prompt_tokens: row.prompt_tokens as number,
      completion_tokens: row.completion_tokens as number,
      ttft_ms: row.ttft_ms as number,
      total_ms: row.total_ms as number,
      tool_latency_json: row.tool_latency_json as string,
      steps: row.steps as number,
      status: row.status as string,
      created_at: row.created_at as string,
    };
  }
}
