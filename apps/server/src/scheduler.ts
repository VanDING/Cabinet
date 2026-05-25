import { DECISION_EXPIRY_HOURS } from '@cabinet/types';
import { CronExpressionParser } from 'cron-parser';
import cron from 'node-cron';
import type { ScheduledTaskRepository, DecisionRepository } from '@cabinet/storage';

// Broadcast is injected lazily to avoid circular dependencies
let broadcastFn: ((event: string, payload: unknown) => void) | null = null;
export function setSchedulerBroadcast(fn: (event: string, payload: unknown) => void): void {
  broadcastFn = fn;
}

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
  private executor: TaskExecutor | null = null;
  private jobs = new Map<string, ReturnType<typeof cron.schedule>>();
  private autoArchiveJob: ReturnType<typeof cron.schedule> | null = null;

  constructor(scheduledTaskRepo: ScheduledTaskRepository, decisionRepo: DecisionRepository, logger: SchedulerLogger, _pollIntervalMs = 30000) {
    this.scheduledTaskRepo = scheduledTaskRepo;
    this.decisionRepo = decisionRepo;
    this.logger = logger;
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

    const effectiveCron = this.validateOrFallback(cronExpression);
    const job = cron.schedule(effectiveCron, () => this.executeTask(id));
    job.start();
    this.jobs.set(id, job);

    this.logger.info('Scheduled task created', { id, name, cron: cronExpression });
    return { id };
  }

  list(): ScheduledTask[] {
    return this.scheduledTaskRepo.findAll().map(rowToScheduledTask);
  }

  cancel(id: string): void {
    const job = this.jobs.get(id);
    if (job) {
      job.stop();
      job.destroy();
      this.jobs.delete(id);
    }
    this.scheduledTaskRepo.disable(id);
    this.logger.info('Scheduled task cancelled', { id });
  }

  // ── Lifecycle ──

  start(): void {
    // Reload all enabled tasks from SQLite and register node-cron jobs
    const tasks = this.scheduledTaskRepo.findAll();
    for (const task of tasks) {
      const effectiveCron = this.validateOrFallback(task.cron_expression);
      const job = cron.schedule(effectiveCron, () => this.executeTask(task.id));
      job.start();
      this.jobs.set(task.id, job);
    }

    this.autoArchiveJob = cron.schedule('0 * * * *', () => this.runAutoArchive());
    this.autoArchiveJob.start();

    this.logger.info('TaskScheduler started', { tasksLoaded: tasks.length });
  }

  stop(): void {
    for (const [id, job] of this.jobs) {
      job.stop();
      job.destroy();
    }
    this.jobs.clear();

    if (this.autoArchiveJob) {
      this.autoArchiveJob.stop();
      this.autoArchiveJob.destroy();
      this.autoArchiveJob = null;
    }

    this.logger.info('TaskScheduler stopped');
  }

  // ── Internal ──

  private async executeTask(taskId: string): Promise<void> {
    const rows = this.scheduledTaskRepo.findAll();
    const row = rows.find((r) => r.id === taskId);
    if (!row) return;
    const task = rowToScheduledTask(row);

    try {
      const now = new Date().toISOString();
      this.scheduledTaskRepo.updateLastRun(task.id, now);

      if (!task.recurring) {
        this.scheduledTaskRepo.disable(task.id);
        const job = this.jobs.get(task.id);
        if (job) {
          job.stop();
          job.destroy();
          this.jobs.delete(task.id);
        }
      } else {
        const next = this.nextCronTime(task.cronExpression);
        this.scheduledTaskRepo.updateRunTimings(task.id, now, next);
      }

      if (this.executor) {
        await this.executor(task);
      }
      broadcastFn?.('task_executed', { taskId: task.id, name: task.name, executedAt: now });
    } catch (err) {
      this.logger.error('Task execution error', { id: task.id, error: (err as Error).message });
    }
  }

  private runAutoArchive(): void {
    try {
      this.decisionRepo.expireOlderThan(DECISION_EXPIRY_HOURS);
      this.decisionRepo.archiveExpired();
    } catch (err) {
      this.logger.error('Auto-archive error', { error: (err as Error).message });
    }
  }

  private validateOrFallback(cronExpression: string): string {
    if (cron.validate(cronExpression)) return cronExpression;
    this.logger.warn('Invalid cron expression, falling back to every minute', { cron: cronExpression });
    return '* * * * *';
  }

  private nextCronTime(cronExpression: string): string {
    try {
      const expr = CronExpressionParser.parse(cronExpression);
      return expr.next().toDate().toISOString();
    } catch {
      return new Date(Date.now() + 60000).toISOString();
    }
  }
}

export function startAutoArchive(
  scheduledTaskRepo: ScheduledTaskRepository,
  decisionRepo: DecisionRepository,
  logger: SchedulerLogger,
  _checkIntervalMs: number = 3600000,
): () => void {
  const scheduler = new TaskScheduler(scheduledTaskRepo, decisionRepo, logger);
  scheduler.start();
  return () => scheduler.stop();
}
