import { DECISION_EXPIRY_HOURS } from '@cabinet/types';
import { CronExpressionParser } from 'cron-parser';
import cron from 'node-cron';
import type { WorkflowRepository, DecisionRepository } from '@cabinet/storage';

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
  workflowId: string;
  name: string;
  cronExpression: string;
  prompt?: string;
  recurring: boolean;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
}

export type TaskExecutor = (task: ScheduledTask) => Promise<void>;

export class TaskScheduler {
  private workflowRepo: WorkflowRepository;
  private decisionRepo: DecisionRepository;
  private logger: SchedulerLogger;
  private executor: TaskExecutor | null = null;
  private jobs = new Map<string, ReturnType<typeof cron.schedule>>();
  private autoArchiveJob: ReturnType<typeof cron.schedule> | null = null;
  private lastRunMap = new Map<string, string>();

  constructor(
    workflowRepo: WorkflowRepository,
    decisionRepo: DecisionRepository,
    logger: SchedulerLogger,
  ) {
    this.workflowRepo = workflowRepo;
    this.decisionRepo = decisionRepo;
    this.logger = logger;
  }

  setExecutor(executor: TaskExecutor): void {
    this.executor = executor;
  }

  // ── Schedule / Unschedule ──

  schedule(workflowId: string, name: string, cronExpression: string): void {
    this.workflowRepo.updateCron(workflowId, cronExpression);

    this.unschedule(workflowId);

    const effectiveCron = this.validateOrFallback(cronExpression);
    const job = cron.schedule(effectiveCron, () => this.executeTask(workflowId));
    job.start();
    this.jobs.set(workflowId, job);

    this.logger.info('Workflow scheduled', { workflowId, name, cron: cronExpression });
  }

  unschedule(workflowId: string): void {
    const job = this.jobs.get(workflowId);
    if (job) {
      job.stop();
      job.destroy();
      this.jobs.delete(workflowId);
    }
  }

  // ── Lifecycle ──

  start(): void {
    // Load all workflows with cron_expression from database
    const workflows = this.workflowRepo.findByCron();
    for (const wf of workflows) {
      if (!wf.cron_expression) continue;
      const effectiveCron = this.validateOrFallback(wf.cron_expression);
      const job = cron.schedule(effectiveCron, () => this.executeTask(wf.id));
      job.start();
      this.jobs.set(wf.id, job);
    }

    this.autoArchiveJob = cron.schedule('0 * * * *', () => this.runAutoArchive());
    this.autoArchiveJob.start();

    this.logger.info('TaskScheduler started', { scheduledWorkflows: workflows.length });
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

  // ── CRUD compatibility ──

  list(): ScheduledTask[] {
    return this.workflowRepo.findByCron().map((wf) => ({
      id: wf.id,
      workflowId: wf.id,
      name: wf.name,
      cronExpression: wf.cron_expression ?? '',
      recurring: true,
      enabled: true,
      lastRunAt: this.lastRunMap.get(wf.id),
      nextRunAt: this.nextCronTime(wf.cron_expression ?? ''),
    }));
  }

  // ── Internal ──

  private async executeTask(workflowId: string): Promise<void> {
    const wf = this.workflowRepo.findById(workflowId);
    if (!wf) return;

    try {
      const now = new Date().toISOString();
      this.lastRunMap.set(workflowId, now);

      if (this.executor) {
        await this.executor({
          id: workflowId,
          workflowId,
          name: wf.name,
          cronExpression: wf.cron_expression ?? '',
          recurring: true,
          enabled: true,
          lastRunAt: now,
        });
      }
      broadcastFn?.('task_executed', { taskId: workflowId, name: wf.name, executedAt: now });
    } catch (err) {
      this.logger.error('Task execution error', { id: workflowId, error: (err as Error).message });
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
    this.logger.warn('Invalid cron expression, falling back to every minute', {
      cron: cronExpression,
    });
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
  workflowRepo: WorkflowRepository,
  decisionRepo: DecisionRepository,
  logger: SchedulerLogger,
): () => void {
  const scheduler = new TaskScheduler(workflowRepo, decisionRepo, logger);
  scheduler.start();
  return () => scheduler.stop();
}
