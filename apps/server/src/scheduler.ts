import { DECISION_EXPIRY_HOURS } from '@cabinet/types';
import type { ScheduledTaskRepository, DecisionRepository } from '@cabinet/storage';

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

function rowToScheduledTask(r: { id: string; name: string; cron_expression: string; prompt: string; recurring: number; enabled: number; last_run_at: string | null; next_run_at: string | null }): ScheduledTask {
  return {
    id: r.id,
    name: r.name,
    cronExpression: r.cron_expression,
    prompt: r.prompt,
    recurring: r.recurring === 1,
    enabled: r.enabled === 1,
    lastRunAt: r.last_run_at ?? undefined,
    nextRunAt: r.next_run_at ?? undefined,
  };
}

export class TaskScheduler {
  private scheduledTaskRepo: ScheduledTaskRepository;
  private decisionRepo: DecisionRepository;
  private logger: SchedulerLogger;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private autoArchiveTimer: ReturnType<typeof setInterval> | null = null;
  private executor: TaskExecutor | null = null;
  private pollIntervalMs: number;

  constructor(scheduledTaskRepo: ScheduledTaskRepository, decisionRepo: DecisionRepository, logger: SchedulerLogger, pollIntervalMs = 30000) {
    this.scheduledTaskRepo = scheduledTaskRepo;
    this.decisionRepo = decisionRepo;
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
    this.scheduledTaskRepo.insert({
      id,
      name,
      cron_expression: cronExpression,
      prompt,
      recurring: recurring ? 1 : 0,
      enabled: 1,
      created_at: new Date().toISOString(),
      last_run_at: null,
      next_run_at: nextRun,
    });
    this.logger.info('Scheduled task created', { id, name, cron: cronExpression });
    return { id };
  }

  list(): ScheduledTask[] {
    return this.scheduledTaskRepo.findAll().map(rowToScheduledTask);
  }

  cancel(id: string): void {
    this.scheduledTaskRepo.disable(id);
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
      const rows = this.scheduledTaskRepo.findDue(now);

      for (const row of rows) {
        await this.executeTask(rowToScheduledTask(row));
      }
    } catch (err) {
      this.logger.error('Scheduler poll error', { error: (err as Error).message });
    }
  }

  private async executeTask(task: ScheduledTask): Promise<void> {
    try {
      const now = new Date().toISOString();
      this.scheduledTaskRepo.updateLastRun(task.id, now);

      if (!task.recurring) {
        this.scheduledTaskRepo.disable(task.id);
      } else {
        const next = this.nextCronTime(task.cronExpression);
        this.scheduledTaskRepo.updateRunTimings(task.id, now, next);
      }

      if (this.executor) {
        await this.executor(task);
      }
    } catch (err) {
      this.logger.error('Task execution error', { id: task.id, error: (err as Error).message });
    }
  }

  private startAutoArchive(): void {
    const check = () => {
      try {
        this.decisionRepo.expireOlderThan(DECISION_EXPIRY_HOURS);
        this.decisionRepo.archiveExpired();
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
  scheduledTaskRepo: ScheduledTaskRepository,
  decisionRepo: DecisionRepository,
  logger: SchedulerLogger,
  checkIntervalMs: number = 3600000,
): () => void {
  const scheduler = new TaskScheduler(scheduledTaskRepo, decisionRepo, logger, checkIntervalMs);
  scheduler.start();
  return () => scheduler.stop();
}
