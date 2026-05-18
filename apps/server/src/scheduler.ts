import { DECISION_EXPIRY_HOURS } from '@cabinet/types';
import type { Database } from '@cabinet/storage';

export interface SchedulerLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface ScheduledTask {
  id: string;
  name: string;
  cronExpression: string;
  prompt: string;
  recurring: boolean;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
}

export type TaskExecutor = (task: ScheduledTask) => Promise<void>;

export class TaskScheduler {
  private db: Database;
  private logger: SchedulerLogger;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private autoArchiveTimer: ReturnType<typeof setInterval> | null = null;
  private executor: TaskExecutor | null = null;
  private pollIntervalMs: number;

  constructor(db: Database, logger: SchedulerLogger, pollIntervalMs = 30000) {
    this.db = db;
    this.logger = logger;
    this.pollIntervalMs = pollIntervalMs;
  }

  setExecutor(executor: TaskExecutor): void {
    this.executor = executor;
  }

  // ── Task CRUD (called by secretary callbacks) ──

  schedule(name: string, cronExpression: string, prompt: string, recurring: boolean): { id: string } {
    const id = `task_${Date.now()}`;
    const nextRun = this.nextCronTime(cronExpression);
    this.db
      .prepare(
        `INSERT INTO scheduled_tasks (id, name, cron_expression, prompt, recurring, next_run_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, name, cronExpression, prompt, recurring ? 1 : 0, nextRun);
    this.logger.info('Scheduled task created', { id, name, cron: cronExpression });
    return { id };
  }

  list(): ScheduledTask[] {
    const rows = this.db
      .prepare('SELECT id, name, cron_expression, prompt, recurring, enabled, last_run_at, next_run_at FROM scheduled_tasks WHERE enabled = 1 ORDER BY created_at DESC')
      .all() as any[];
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      cronExpression: r.cron_expression,
      prompt: r.prompt,
      recurring: r.recurring === 1,
      enabled: r.enabled === 1,
      lastRunAt: r.last_run_at ?? undefined,
      nextRunAt: r.next_run_at ?? undefined,
    }));
  }

  cancel(id: string): void {
    this.db.prepare('UPDATE scheduled_tasks SET enabled = 0 WHERE id = ?').run(id);
    this.logger.info('Scheduled task cancelled', { id });
  }

  // ── Lifecycle ──

  start(): void {
    this.startAutoArchive();
    this.startPolling();
    this.logger.info('TaskScheduler started', { pollIntervalMs: this.pollIntervalMs });
  }

  stop(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.autoArchiveTimer) { clearInterval(this.autoArchiveTimer); this.autoArchiveTimer = null; }
    this.logger.info('TaskScheduler stopped');
  }

  // ── Internal ──

  private startPolling(): void {
    this.pollTimer = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  private async poll(): Promise<void> {
    try {
      const now = new Date().toISOString();
      const rows = this.db
        .prepare(
          `SELECT id, name, cron_expression, prompt, recurring, enabled, last_run_at, next_run_at
           FROM scheduled_tasks
           WHERE enabled = 1 AND next_run_at <= ?`,
        )
        .all(now) as any[];

      for (const row of rows) {
        await this.executeTask({
          id: row.id,
          name: row.name,
          cronExpression: row.cron_expression,
          prompt: row.prompt,
          recurring: row.recurring === 1,
          enabled: row.enabled === 1,
          lastRunAt: row.last_run_at ?? undefined,
          nextRunAt: row.next_run_at ?? undefined,
        });
      }
    } catch (err) {
      this.logger.error('Scheduler poll error', { error: (err as Error).message });
    }
  }

  private async executeTask(task: ScheduledTask): Promise<void> {
    try {
      const now = new Date().toISOString();
      this.db.prepare('UPDATE scheduled_tasks SET last_run_at = ? WHERE id = ?').run(now, task.id);

      if (!task.recurring) {
        this.db.prepare('UPDATE scheduled_tasks SET enabled = 0, next_run_at = NULL WHERE id = ?').run(task.id);
      } else {
        const next = this.nextCronTime(task.cronExpression);
        this.db.prepare('UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?').run(next, task.id);
      }

      if (this.executor) {
        await this.executor(task);
      }
    } catch (err) {
      this.logger.error('Task execution error', { id: task.id, error: (err as Error).message });
    }
  }

  private startAutoArchive(): void {
    const expiryMs = DECISION_EXPIRY_HOURS * 60 * 60 * 1000;
    const check = () => {
      try {
        const cutoff = new Date(Date.now() - expiryMs).toISOString();
        const expired = this.db
          .prepare(
            "UPDATE decisions SET status = 'expired', resolved_at = datetime('now') WHERE status = 'pending' AND created_at < ?",
          )
          .run(cutoff);
        if (expired.changes > 0) {
          this.logger.info('Auto-expired decisions', { count: expired.changes });
          this.db.prepare("UPDATE decisions SET status = 'archived' WHERE status = 'expired'").run();
        }
      } catch (err) {
        this.logger.error('Auto-archive error', { error: (err as Error).message });
      }
    };
    this.autoArchiveTimer = setInterval(check, 3600000);
  }

  private nextCronTime(cronExpression: string): string {
    const now = new Date();
    const parts = cronExpression.trim().split(/\s+/);
    if (parts.length !== 5) {
      return new Date(now.getTime() + 60000).toISOString();
    }
    const min = parts[0] ?? '*';
    const hour = parts[1] ?? '*';
    const dom = parts[2] ?? '*';
    const month = parts[3] ?? '*';
    const dow = parts[4] ?? '*';
    const next = new Date(now);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + 1);

    for (let i = 0; i < 1440; i++) {
      if (
        this.matchField(min, next.getMinutes(), 0, 59) &&
        this.matchField(hour, next.getHours(), 0, 23) &&
        this.matchField(dom, next.getDate(), 1, 31) &&
        this.matchField(month, next.getMonth() + 1, 1, 12) &&
        this.matchField(dow, next.getDay(), 0, 6)
      ) {
        return next.toISOString();
      }
      next.setMinutes(next.getMinutes() + 1);
    }
    return new Date(now.getTime() + 60000).toISOString();
  }

  private matchField(field: string, value: number, _min: number, _max: number): boolean {
    if (field === '*') return true;
    for (const part of field.split(',')) {
      if (part.includes('/')) {
        const [range, step] = part.split('/');
        const stepNum = parseInt(step ?? '1', 10);
        if (range === '*') {
          if (value % stepNum === 0) return true;
        }
      } else if (part.includes('-')) {
        const [lo, hi] = part.split('-');
        if (value >= parseInt(lo ?? '0', 10) && value <= parseInt(hi ?? '0', 10)) return true;
      } else {
        if (parseInt(part, 10) === value) return true;
      }
    }
    return false;
  }
}

export function startAutoArchive(
  db: Database,
  logger: SchedulerLogger,
  checkIntervalMs: number = 3600000,
): () => void {
  const scheduler = new TaskScheduler(db, logger, checkIntervalMs);
  scheduler.start();
  return () => scheduler.stop();
}
