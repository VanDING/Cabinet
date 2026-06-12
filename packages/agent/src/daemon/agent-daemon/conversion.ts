import type { TaskQueueEntry, TaskQueueStatus } from '@cabinet/types';
import type { TaskQueueRow } from '@cabinet/storage';

export function rowToEntry(row: TaskQueueRow): TaskQueueEntry {
  return {
    id: row.id,
    agentId: row.agent_id,
    sessionId: row.session_id,
    capability: row.capability,
    input: row.input.startsWith('{') ? JSON.parse(row.input) : row.input,
    slot: JSON.parse(row.slot_json),
    status: row.status as TaskQueueStatus,
    priority: row.priority,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    timeoutMs: row.timeout_ms,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    progress: JSON.parse(row.progress_json),
    errorMessage: row.error_message,
    output: row.output_json ? JSON.parse(row.output_json) : null,
    cronExpression: row.cron_expression,
    webhookUrl: row.webhook_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
