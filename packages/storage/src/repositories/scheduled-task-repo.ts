import type Database from 'better-sqlite3';

export interface ScheduledTaskRow {
  id: string;
  name: string;
  cron_expression: string;
  prompt: string;
  recurring: number;
  enabled: number;
  created_at: string;
  last_run_at: string | null;
  next_run_at: string | null;
}

export class ScheduledTaskRepository {
  constructor(private readonly db: Database.Database) {}

  findAll(): ScheduledTaskRow[] {
    const rows = this.db
      .prepare('SELECT * FROM scheduled_tasks WHERE enabled = 1 ORDER BY created_at DESC')
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToTask(r));
  }

  insert(task: ScheduledTaskRow): void {
    this.db
      .prepare(
        'INSERT INTO scheduled_tasks (id, name, cron_expression, prompt, recurring, enabled, created_at, last_run_at, next_run_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(task.id, task.name, task.cron_expression, task.prompt, task.recurring, task.enabled, task.created_at, task.last_run_at, task.next_run_at);
  }

  updateLastRun(id: string, lastRunAt: string): void {
    this.db.prepare('UPDATE scheduled_tasks SET last_run_at = ? WHERE id = ?').run(lastRunAt, id);
  }

  updateNextRun(id: string, nextRunAt: string): void {
    this.db.prepare('UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?').run(nextRunAt, id);
  }

  /** Atomically update lastRunAt and nextRunAt in a single transaction. */
  updateRunTimings(id: string, lastRunAt: string, nextRunAt: string): void {
    const run = this.db.transaction(() => {
      this.db.prepare('UPDATE scheduled_tasks SET last_run_at = ? WHERE id = ?').run(lastRunAt, id);
      this.db.prepare('UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?').run(nextRunAt, id);
    });
    run();
  }

  disable(id: string): void {
    this.db
      .prepare('UPDATE scheduled_tasks SET enabled = 0, next_run_at = NULL WHERE id = ?')
      .run(id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
  }

  private rowToTask(row: Record<string, unknown>): ScheduledTaskRow {
    return {
      id: row.id as string,
      name: row.name as string,
      cron_expression: row.cron_expression as string,
      prompt: row.prompt as string,
      recurring: row.recurring as number,
      enabled: row.enabled as number,
      created_at: row.created_at as string,
      last_run_at: row.last_run_at as string | null,
      next_run_at: row.next_run_at as string | null,
    };
  }
}
