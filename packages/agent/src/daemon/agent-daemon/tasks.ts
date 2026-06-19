import type { ContextSlot, TaskQueueEntry } from '@cabinet/types';
import type { AgentDaemonState } from './internal.js';
import { rowToEntry } from './conversion.js';

/** Enqueue a task for async execution. Returns the task ID. */
export async function enqueueTask(
  daemon: AgentDaemonState,
  params: {
    agentId: string;
    sessionId: string;
    capability?: string;
    input: unknown;
    slot: ContextSlot;
    priority?: number;
    maxRetries?: number;
    timeoutMs?: number;
  },
): Promise<string> {
  const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  daemon.taskRepo.enqueue({
    id,
    agent_id: params.agentId,
    session_id: params.sessionId,
    capability: params.capability ?? 'default',
    input: typeof params.input === 'string' ? params.input : JSON.stringify(params.input),
    slot_json: JSON.stringify(params.slot),
    status: 'pending',
    priority: params.priority ?? 0,
    retry_count: 0,
    max_retries: params.maxRetries ?? 3,
    timeout_ms: params.timeoutMs ?? daemon.opts.taskTimeoutMs,
    claimed_by: null,
    claimed_at: null,
    started_at: null,
    completed_at: null,
    progress_json: '{}',
    error_message: null,
    output_json: null,
    cron_expression: null,
    webhook_url: null,
  });
  daemon.logger.info('Task enqueued', { taskId: id, agentId: params.agentId });
  return id;
}

/** Cancel a pending or claimed task. */
export function cancelTask(daemon: AgentDaemonState, taskId: string): boolean {
  const row = daemon.taskRepo.findById(taskId);
  if (!row) return false;
  if (row.status === 'completed' || row.status === 'cancelled') return false;

  if (row.status === 'running') {
    const adapter = daemon.activeTasks.get(taskId);
    if (adapter) {
      adapter.cancelTask?.(taskId).catch(() => {});
      daemon.activeTasks.delete(taskId);
    }
  }

  daemon.taskRepo.updateStatus(taskId, 'cancelled');
  daemon.logger.info('Task cancelled', { taskId });
  return true;
}

/** Retry a failed task. */
export function retryTask(daemon: AgentDaemonState, taskId: string): TaskQueueEntry | null {
  const row = daemon.taskRepo.retryTask(taskId);
  if (!row) return null;
  daemon.logger.info('Task retried', { taskId });
  return rowToEntry(row);
}

/** Get task by ID. */
export function getTask(daemon: AgentDaemonState, taskId: string): TaskQueueEntry | null {
  const row = daemon.taskRepo.findById(taskId);
  return row ? rowToEntry(row) : null;
}

/** List tasks with optional filters. */
export function listTasks(
  daemon: AgentDaemonState,
  filter?: { status?: string; agentId?: string; limit?: number },
): TaskQueueEntry[] {
  if (filter?.agentId && filter?.status) {
    return daemon.taskRepo
      .findByAgent(filter.agentId, filter.status, filter.limit)
      .map((r) => rowToEntry(r));
  }
  if (filter?.status) {
    return daemon.taskRepo.findByStatus(filter.status, filter.limit).map((r) => rowToEntry(r));
  }
  if (filter?.agentId) {
    return daemon.taskRepo
      .findByAgent(filter.agentId, undefined, filter.limit)
      .map((r) => rowToEntry(r));
  }
  return daemon.taskRepo
    .findByStatus(['pending', 'claimed', 'running'], filter?.limit ?? 50)
    .map((r) => rowToEntry(r));
}
