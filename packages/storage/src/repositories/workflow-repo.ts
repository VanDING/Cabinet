import type Database from 'better-sqlite3';

export interface WorkflowRow {
  id: string;
  project_id: string;
  name: string;
  definition: string;
  status: string;
  cron_expression: string | null;
  created_at: string;
}

export interface WorkflowRunRow {
  run_id: string;
  workflow_id: string;
  status: string;
  current_node_id: string | null;
  steps: string;
  results: string;
  started_at: string;
  updated_at: string;
}

export class WorkflowRepository {
  constructor(private readonly db: Database.Database) {}

  // ── Workflows ──

  create(id: string, projectId: string, name: string, definition: string, status = 'draft', cronExpression?: string): void {
    this.db
      .prepare(
        'INSERT INTO workflows (id, project_id, name, definition, status, cron_expression) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, projectId, name, definition, status, cronExpression ?? null);
  }

  findById(id: string): WorkflowRow | null {
    const row = this.db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.rowToWorkflow(row);
  }

  listByProject(projectId: string, opts?: { limit?: number; offset?: number }): WorkflowRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM workflows WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(projectId, opts?.limit ?? 100, opts?.offset ?? 0) as Record<string, unknown>[];
    return rows.map((r) => this.rowToWorkflow(r));
  }

  listAll(opts?: { limit?: number; offset?: number }): WorkflowRow[] {
    const rows = this.db
      .prepare('SELECT * FROM workflows ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(opts?.limit ?? 100, opts?.offset ?? 0) as Record<string, unknown>[];
    return rows.map((r) => this.rowToWorkflow(r));
  }

  updateNameAndDefinition(id: string, name?: string, definition?: string): void {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (name !== undefined) {
      sets.push('name = ?');
      values.push(name);
    }
    if (definition !== undefined) {
      sets.push('definition = ?');
      values.push(definition);
    }
    if (sets.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE workflows SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  updateStatus(id: string, status: string): void {
    this.db.prepare('UPDATE workflows SET status = ? WHERE id = ?').run(status, id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
  }

  deleteByProject(projectId: string): void {
    this.db.prepare('DELETE FROM workflows WHERE project_id = ?').run(projectId);
  }

  countByStatus(statuses: string[]): number {
    const placeholders = statuses.map(() => '?').join(',');
    const row = this.db
      .prepare(`SELECT COUNT(*) as count FROM workflows WHERE status IN (${placeholders})`)
      .get(...statuses) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  findByCron(): WorkflowRow[] {
    const rows = this.db
      .prepare('SELECT * FROM workflows WHERE cron_expression IS NOT NULL')
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToWorkflow(r));
  }

  updateCron(id: string, cronExpression: string | null): void {
    this.db
      .prepare('UPDATE workflows SET cron_expression = ? WHERE id = ?')
      .run(cronExpression, id);
  }

  private rowToWorkflow(row: Record<string, unknown>): WorkflowRow {
    return {
      id: row.id as string,
      project_id: row.project_id as string,
      name: row.name as string,
      definition: row.definition as string,
      status: row.status as string,
      cron_expression: (row.cron_expression as string) ?? null,
      created_at: row.created_at as string,
    };
  }

  // ── Workflow Runs ──

  saveRun(run: WorkflowRunRow): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO workflow_runs (run_id, workflow_id, status, current_node_id, steps, results, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        run.run_id,
        run.workflow_id,
        run.status,
        run.current_node_id,
        run.steps,
        run.results,
        run.started_at,
      );
  }

  findRunById(runId: string): WorkflowRunRow | null {
    const row = this.db.prepare('SELECT * FROM workflow_runs WHERE run_id = ?').get(runId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.rowToRun(row);
  }

  findRunsByWorkflow(workflowId: string): WorkflowRunRow[] {
    const rows = this.db
      .prepare('SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY updated_at DESC')
      .all(workflowId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToRun(r));
  }

  findRunsByStatus(statuses: string[]): WorkflowRunRow[] {
    const placeholders = statuses.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT * FROM workflow_runs WHERE status IN (${placeholders}) ORDER BY updated_at DESC`,
      )
      .all(...statuses) as Record<string, unknown>[];
    return rows.map((r) => this.rowToRun(r));
  }

  updateRunStatus(runId: string, status: string): void {
    this.db
      .prepare("UPDATE workflow_runs SET status = ?, updated_at = datetime('now') WHERE run_id = ?")
      .run(status, runId);
  }

  failAwaitingRuns(workflowId: string): void {
    this.db
      .prepare(
        "UPDATE workflow_runs SET status = 'failed', updated_at = datetime('now') WHERE workflow_id = ? AND status = 'awaiting_approval'",
      )
      .run(workflowId);
  }

  // ── Incremental Step / Result Persistence ──

  appendStep(runId: string, nodeId: string, nodeType: string, output: string): void {
    this.db
      .prepare(
        'INSERT INTO workflow_run_steps (run_id, node_id, node_type, output) VALUES (?, ?, ?, ?)',
      )
      .run(runId, nodeId, nodeType, output);
  }

  appendResult(runId: string, key: string, value: string): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO workflow_run_results (run_id, result_key, result_value) VALUES (?, ?, ?)',
      )
      .run(runId, key, value);
  }

  findStepsByRunId(runId: string): Array<{ nodeId: string; type: string; output: string }> {
    const rows = this.db
      .prepare(
        'SELECT node_id, node_type, output FROM workflow_run_steps WHERE run_id = ? ORDER BY id ASC',
      )
      .all(runId) as Record<string, unknown>[];
    return rows.map((r) => ({
      nodeId: r.node_id as string,
      type: r.node_type as string,
      output: r.output as string,
    }));
  }

  findResultsByRunId(runId: string): Record<string, string> {
    const rows = this.db
      .prepare('SELECT result_key, result_value FROM workflow_run_results WHERE run_id = ?')
      .all(runId) as Record<string, unknown>[];
    const results: Record<string, string> = {};
    for (const r of rows) {
      results[r.result_key as string] = r.result_value as string;
    }
    return results;
  }

  private rowToRun(row: Record<string, unknown>): WorkflowRunRow {
    return {
      run_id: row.run_id as string,
      workflow_id: row.workflow_id as string,
      status: row.status as string,
      current_node_id: row.current_node_id as string | null,
      steps: row.steps as string,
      results: row.results as string,
      started_at: row.started_at as string,
      updated_at: row.updated_at as string,
    };
  }
}
