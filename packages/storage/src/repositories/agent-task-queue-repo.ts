//
// AgentTaskQueueRepository — persistence for the pull-mode task queue.
//
// Provides atomic claim (CAS), status transitions, stale claim detection,
// and batch reset for orphan recovery. All writes are safe for concurrent
// access via SQLite serialized WAL mode.
//

import type Database from 'better-sqlite3';

export interface TaskQueueRow {
  id: string;
  agent_id: string;
  session_id: string;
  capability: string;
  input: string;
  slot_json: string;
  status: string;
  priority: number;
  retry_count: number;
  max_retries: number;
  timeout_ms: number;
  claimed_by: string | null;
  claimed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  progress_json: string;
  error_message: string | null;
  output_json: string | null;
  cron_expression: string | null;
  webhook_url: string | null;
  created_at: string;
  updated_at: string;
}

export class AgentTaskQueueRepository {
  constructor(private readonly db: Database.Database) {}

  /** Enqueue a new task. Returns the task ID. */
  enqueue(row: Omit<TaskQueueRow, 'created_at' | 'updated_at'>): string {
    const stmt = this.db.prepare(`
      INSERT INTO agent_task_queue (id, agent_id, session_id, capability, input, slot_json, status,
        priority, retry_count, max_retries, timeout_ms, claimed_by, claimed_at,
        started_at, completed_at, progress_json, error_message, output_json,
        cron_expression, webhook_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      row.id,
      row.agent_id,
      row.session_id,
      row.capability,
      row.input,
      row.slot_json,
      row.status,
      row.priority,
      row.retry_count,
      row.max_retries,
      row.timeout_ms,
      row.claimed_by,
      row.claimed_at,
      row.started_at,
      row.completed_at,
      row.progress_json,
      row.error_message,
      row.output_json,
      row.cron_expression,
      row.webhook_url,
    );
    return row.id;
  }

  /**
   * Atomically claim the next pending task for an agent.
   * Uses a transaction to SELECT + UPDATE within a single serialized write.
   * Returns the claimed task or null if none available.
   */
  claimNext(agentId: string, daemonId: string): TaskQueueRow | null {
    const claim = this.db.transaction((): TaskQueueRow | null => {
      const row = this.db
        .prepare(
          `
        SELECT id FROM agent_task_queue
        WHERE agent_id = ? AND status = 'pending'
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
      `,
        )
        .get(agentId) as { id: string } | undefined;
      if (!row) return null;

      const now = new Date().toISOString();
      this.db
        .prepare(
          `
        UPDATE agent_task_queue SET status = 'claimed', claimed_by = ?, claimed_at = ?,
          updated_at = ?
        WHERE id = ? AND status = 'pending'
      `,
        )
        .run(daemonId, now, now, row.id);

      return this.findById(row.id);
    });
    return claim();
  }

  /** Claim a specific task by ID (used for explicit assignment). */
  claimSpecific(taskId: string, daemonId: string): TaskQueueRow | null {
    const claim = this.db.transaction((): TaskQueueRow | null => {
      const now = new Date().toISOString();
      const result = this.db
        .prepare(
          `
        UPDATE agent_task_queue SET status = 'claimed', claimed_by = ?, claimed_at = ?,
          updated_at = ?
        WHERE id = ? AND status = 'pending'
      `,
        )
        .run(daemonId, now, now, taskId);
      if (result.changes === 0) return null;
      return this.findById(taskId);
    });
    return claim();
  }

  /** Update task status and optional extra fields. */
  updateStatus(
    taskId: string,
    status: string,
    extra?: { errorMessage?: string; output?: unknown; startedAt?: string; completedAt?: string },
  ): void {
    const sets: string[] = ['status = ?', "updated_at = datetime('now')"];
    const params: unknown[] = [status];
    if (extra?.errorMessage !== undefined) {
      sets.push('error_message = ?');
      params.push(extra.errorMessage);
    }
    if (extra?.output !== undefined) {
      sets.push('output_json = ?');
      params.push(JSON.stringify(extra.output));
    }
    if (extra?.startedAt) {
      sets.push('started_at = ?');
      params.push(extra.startedAt);
    }
    if (extra?.completedAt) {
      sets.push('completed_at = ?');
      params.push(extra.completedAt);
    }
    params.push(taskId);
    this.db.prepare(`UPDATE agent_task_queue SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  /** Update task progress. */
  updateProgress(
    taskId: string,
    progress: { percent: number; message: string; step: number },
  ): void {
    this.db
      .prepare(
        `
      UPDATE agent_task_queue SET progress_json = ?, updated_at = datetime('now') WHERE id = ?
    `,
      )
      .run(JSON.stringify(progress), taskId);
  }

  /** Find a task by ID. */
  findById(taskId: string): TaskQueueRow | null {
    const row = this.db.prepare('SELECT * FROM agent_task_queue WHERE id = ?').get(taskId) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToTask(row) : null;
  }

  /** List tasks by status(es), newest first. */
  findByStatus(status: string | string[], limit = 50): TaskQueueRow[] {
    const statusList = Array.isArray(status) ? status : [status];
    const placeholders = statusList.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_task_queue WHERE status IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...statusList, limit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToTask(r));
  }

  /** List tasks for a specific agent. */
  findByAgent(agentId: string, status?: string, limit = 50): TaskQueueRow[] {
    const where = status ? 'agent_id = ? AND status = ?' : 'agent_id = ?';
    const params: unknown[] = status ? [agentId, status, limit] : [agentId, limit];
    const rows = this.db
      .prepare(`SELECT * FROM agent_task_queue WHERE ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.rowToTask(r));
  }

  /** Count tasks by status for an agent. */
  countByStatus(agentId: string): Record<string, number> {
    const rows = this.db
      .prepare(
        `
      SELECT status, COUNT(*) as cnt FROM agent_task_queue WHERE agent_id = ? GROUP BY status
    `,
      )
      .all(agentId) as Array<{ status: string; cnt: number }>;
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = r.cnt;
    return counts;
  }

  /**
   * Find tasks that have been claimed but the daemon has not sent a heartbeat
   * within the given threshold. Used for orphan recovery.
   */
  findStaleClaims(heartbeatTimeoutMs: number): TaskQueueRow[] {
    const cutoff = new Date(Date.now() - heartbeatTimeoutMs).toISOString();
    const rows = this.db
      .prepare(
        `
      SELECT * FROM agent_task_queue WHERE status = 'claimed' AND claimed_at < ?
    `,
      )
      .all(cutoff) as Record<string, unknown>[];
    return rows.map((r) => this.rowToTask(r));
  }

  /** Bulk-reset stale claimed tasks back to pending. */
  resetStaleClaims(taskIds: string[]): number {
    if (taskIds.length === 0) return 0;
    const placeholders = taskIds.map(() => '?').join(',');
    const result = this.db
      .prepare(
        `
      UPDATE agent_task_queue SET status = 'pending', claimed_by = NULL, claimed_at = NULL,
        updated_at = datetime('now')
      WHERE id IN (${placeholders}) AND status = 'claimed'
    `,
      )
      .run(...taskIds);
    return result.changes;
  }

  /** Increment retry count and reset to pending for retry. */
  retryTask(taskId: string): TaskQueueRow | null {
    const retry = this.db.transaction((): TaskQueueRow | null => {
      const row = this.findById(taskId);
      if (!row) return null;
      if (row.status !== 'failed') return null;
      const newRetryCount = row.retry_count + 1;
      if (newRetryCount > row.max_retries) return null;
      this.db
        .prepare(
          `
        UPDATE agent_task_queue SET status = 'pending', claimed_by = NULL, claimed_at = NULL,
          retry_count = ?, updated_at = datetime('now')
        WHERE id = ?
      `,
        )
        .run(newRetryCount, taskId);
      return this.findById(taskId);
    });
    return retry();
  }

  private rowToTask(row: Record<string, unknown>): TaskQueueRow {
    return {
      id: row.id as string,
      agent_id: row.agent_id as string,
      session_id: row.session_id as string,
      capability: row.capability as string,
      input: row.input as string,
      slot_json: row.slot_json as string,
      status: row.status as string,
      priority: row.priority as number,
      retry_count: row.retry_count as number,
      max_retries: row.max_retries as number,
      timeout_ms: row.timeout_ms as number,
      claimed_by: row.claimed_by as string | null,
      claimed_at: row.claimed_at as string | null,
      started_at: row.started_at as string | null,
      completed_at: row.completed_at as string | null,
      progress_json: row.progress_json as string,
      error_message: row.error_message as string | null,
      output_json: row.output_json as string | null,
      cron_expression: row.cron_expression as string | null,
      webhook_url: row.webhook_url as string | null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}
