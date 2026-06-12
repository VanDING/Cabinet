import { TaskScheduler, setSchedulerBroadcast } from '../scheduler.js';
import { ScheduledTaskRepository } from '@cabinet/storage';
import { broadcast } from '../ws/handler.js';
import { runWorkflowById } from '../routes/workflows.js';
import type { BuildState } from './build-state.js';

export function initScheduler(state: BuildState): void {
  const { db, workflowRepo, decisionRepo, logger } = state;
  if (!db || !workflowRepo || !decisionRepo || !logger) {
    throw new Error('Missing required state for scheduler');
  }

  const taskScheduler = new TaskScheduler(workflowRepo, decisionRepo, logger);
  setSchedulerBroadcast((event, payload) => broadcast(event as any, payload as any));

  try {
    const stRepo = new ScheduledTaskRepository(db);
    const oldTasks = stRepo.findAll();
    if (oldTasks.length > 0) {
      for (const t of oldTasks) {
        const wfDef = {
          steps: [{ type: 'llm', title: t.name, data: { prompt: t.prompt } }],
          nodes: [
            { id: 'start', type: 'start' },
            { id: 'exec', type: 'llm', title: t.name, data: { prompt: t.prompt } },
            { id: 'end', type: 'end' },
          ],
          edges: [
            { from: 'start', to: 'exec' },
            { from: 'exec', to: 'end' },
          ],
        };
        workflowRepo.create(
          t.id,
          'default',
          t.name,
          JSON.stringify(wfDef),
          'draft',
          t.cron_expression,
        );
        stRepo.delete(t.id);
      }
      logger.info('Migrated legacy scheduled tasks to workflows', { count: oldTasks.length });
    }
  } catch {
    /* scheduled_tasks table may not exist — safe to ignore */
  }

  taskScheduler.start();

  taskScheduler.setExecutor(async (task) => {
    if (!state.gateway) {
      logger.warn('Scheduled task skipped — no LLM gateway available', {
        workflowId: task.workflowId,
        name: task.name,
      });
      return;
    }
    try {
      logger.info('Executing scheduled workflow', { workflowId: task.workflowId, name: task.name });
      const result = await runWorkflowById(task.workflowId);
      logger.info('Scheduled workflow completed', {
        workflowId: task.workflowId,
        name: task.name,
        status: result.status,
        steps: result.steps.length,
      });
      broadcast('task_completed', {
        taskId: task.workflowId,
        name: task.name,
        status: result.status,
        executedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('Scheduled workflow failed', {
        workflowId: task.workflowId,
        name: task.name,
        error: (err as Error).message,
      });
    }
  });

  state.taskScheduler = taskScheduler;
}
