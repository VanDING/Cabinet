//
// AutopilotRepository — persistence for autopilot triggers and runs.
//

import type Database from 'better-sqlite3';

export interface AutopilotTriggerRow {
  id: string;
  name: string;
  description: string | null;
  workspace_id: string;
  trigger_type: 'cron' | 'webhook' | 'manual';
  cron_expression: string | null;
  cron_timezone: string;
  webhook_token: string | null;
  webhook_secret: string | null;
  webhook_last_called_at: string | null;
  target_agent_id: string;
  target_workflow_id: string | null;
  input_template: string;
  enabled: number;
  max_retries: number;
  timeout_ms: number;
  created_at: string;
  updated_at: string;
}

export interface AutopilotRunRow {
  id: string;
  trigger_id: string;
  task_id: string;
  trigger_type: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

export type AutopilotRunCreate = Omit<AutopilotRunRow, 'completed_at'>;

export class AutopilotRepository {
  constructor(private readonly db: Database.Database) {}

  // ── Triggers ──

  create(row: Omit<AutopilotTriggerRow, 'created_at' | 'updated_at'>): string {
    this.db
      .prepare(
        `
      INSERT INTO autopilot_triggers (id, name, description, workspace_id, trigger_type,
        cron_expression, cron_timezone, webhook_token, webhook_secret,
        target_agent_id, target_workflow_id, input_template, enabled, max_retries, timeout_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        row.id,
        row.name,
        row.description,
        row.workspace_id,
        row.trigger_type,
        row.cron_expression,
        row.cron_timezone,
        row.webhook_token,
        row.webhook_secret,
        row.target_agent_id,
        row.target_workflow_id,
        row.input_template,
        row.enabled,
        row.max_retries,
        row.timeout_ms,
      );
    return row.id;
  }

  findAllEnabled(workspaceId?: string): AutopilotTriggerRow[] {
    const where = workspaceId ? 'workspace_id = ? AND enabled = 1' : 'enabled = 1';
    const params = workspaceId ? [workspaceId] : [];
    const rows = this.db
      .prepare(`SELECT * FROM autopilot_triggers WHERE ${where} ORDER BY created_at DESC`)
      .all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.rowToTrigger(r));
  }

  findAll(workspaceId?: string): AutopilotTriggerRow[] {
    const where = workspaceId ? 'WHERE workspace_id = ?' : '';
    const params = workspaceId ? [workspaceId] : [];
    const rows = this.db
      .prepare(`SELECT * FROM autopilot_triggers ${where} ORDER BY created_at DESC`)
      .all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.rowToTrigger(r));
  }

  findById(id: string): AutopilotTriggerRow | null {
    const row = this.db.prepare('SELECT * FROM autopilot_triggers WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToTrigger(row) : null;
  }

  findByWebhookToken(token: string): AutopilotTriggerRow | null {
    const row = this.db
      .prepare('SELECT * FROM autopilot_triggers WHERE webhook_token = ? AND enabled = 1')
      .get(token) as Record<string, unknown> | undefined;
    return row ? this.rowToTrigger(row) : null;
  }

  update(id: string, updates: Partial<AutopilotTriggerRow>): void {
    const sets: string[] = ["updated_at = datetime('now')"];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined) continue;
      sets.push(`${k} = ?`);
      params.push(v);
    }
    params.push(id);
    this.db.prepare(`UPDATE autopilot_triggers SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM autopilot_triggers WHERE id = ?').run(id);
  }

  // ── Runs ──

  createRun(row: AutopilotRunCreate): string {
    this.db
      .prepare(
        `
      INSERT INTO autopilot_runs (id, trigger_id, task_id, trigger_type, status, started_at, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        row.id,
        row.trigger_id,
        row.task_id,
        row.trigger_type,
        row.status,
        row.started_at,
        row.error_message,
      );
    return row.id;
  }

  updateRun(
    id: string,
    updates: { status?: string; completed_at?: string; error_message?: string },
  ): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (updates.status) {
      sets.push('status = ?');
      params.push(updates.status);
    }
    if (updates.completed_at) {
      sets.push('completed_at = ?');
      params.push(updates.completed_at);
    }
    if (updates.error_message !== undefined) {
      sets.push('error_message = ?');
      params.push(updates.error_message);
    }
    if (sets.length === 0) return;
    params.push(id);
    this.db.prepare(`UPDATE autopilot_runs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  findRunsByTrigger(triggerId: string, limit = 50): AutopilotRunRow[] {
    const rows = this.db
      .prepare('SELECT * FROM autopilot_runs WHERE trigger_id = ? ORDER BY started_at DESC LIMIT ?')
      .all(triggerId, limit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToRun(r));
  }

  findRunById(id: string): AutopilotRunRow | null {
    const row = this.db.prepare('SELECT * FROM autopilot_runs WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToRun(row) : null;
  }

  // ── Row mappers ──

  private rowToTrigger(row: Record<string, unknown>): AutopilotTriggerRow {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string | null,
      workspace_id: row.workspace_id as string,
      trigger_type: row.trigger_type as 'cron' | 'webhook' | 'manual',
      cron_expression: row.cron_expression as string | null,
      cron_timezone: row.cron_timezone as string,
      webhook_token: row.webhook_token as string | null,
      webhook_secret: row.webhook_secret as string | null,
      webhook_last_called_at: row.webhook_last_called_at as string | null,
      target_agent_id: row.target_agent_id as string,
      target_workflow_id: row.target_workflow_id as string | null,
      input_template: row.input_template as string,
      enabled: row.enabled as number,
      max_retries: row.max_retries as number,
      timeout_ms: row.timeout_ms as number,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }

  private rowToRun(row: Record<string, unknown>): AutopilotRunRow {
    return {
      id: row.id as string,
      trigger_id: row.trigger_id as string,
      task_id: row.task_id as string,
      trigger_type: row.trigger_type as string,
      status: row.status as string,
      started_at: row.started_at as string | null,
      completed_at: row.completed_at as string | null,
      error_message: row.error_message as string | null,
    };
  }
}
