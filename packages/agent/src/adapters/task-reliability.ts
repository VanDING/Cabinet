//
// Task Reliability Infrastructure
//
//   - Task idempotency guard: prevents duplicate dispatch
//   - Approval callback retry: exponential backoff + ACK
//   - Task state machine: running → error/awaiting_recovery → failed
//

import type { EventBus } from '@cabinet/events';
import { MessageType } from '@cabinet/types';

// ── Types ────────────────────────────────────────────────────────

export type TaskReliabilityStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'awaiting_recovery'
  | 'stale';

export interface TaskRecord {
  task_id: string;
  status: TaskReliabilityStatus;
  started_at: number;
  agent_id: string;
  session_id: string;
  retries: number;
  max_retries: number;
}

// ── Idempotency Guard ────────────────────────────────────────────

export class TaskIdempotencyGuard {
  private tasks = new Map<string, TaskRecord>();

  /** Check if a task has already been dispatched. Returns existing record or null. */
  checkDuplicate(taskId: string): TaskRecord | null {
    return this.tasks.get(taskId) ?? null;
  }

  /** Register a new task. Throws if the task_id already exists (call checkDuplicate first). */
  register(task: TaskRecord): void {
    if (this.tasks.has(task.task_id)) {
      throw new Error(`Duplicate task_id: ${task.task_id}`);
    }
    this.tasks.set(task.task_id, task);
  }

  /** Update task status. */
  updateStatus(taskId: string, status: TaskReliabilityStatus): void {
    const existing = this.tasks.get(taskId);
    if (existing) {
      existing.status = status;
    }
  }

  /** Remove a completed/failed task record. */
  remove(taskId: string): void {
    this.tasks.delete(taskId);
  }

  /** List all tasks for an agent. */
  listByAgent(agentId: string): TaskRecord[] {
    return [...this.tasks.values()].filter((t) => t.agent_id === agentId);
  }
}

// ── Approval Callback Retry ──────────────────────────────────────

export interface CallbackResult {
  success: boolean;
  attempts: number;
  lastError?: string;
}

/** Notify an agent of an approval result with exponential backoff retry. */
export async function approvalCallbackWithRetry(
  callbackUrl: string,
  payload: {
    decision_id: string;
    task_id: string;
    status: 'approved' | 'rejected';
    chosen_option?: { label: string; value: string };
    captain_comment?: string;
    timestamp: string;
  },
  maxRetries = 3,
  eventBus?: EventBus,
): Promise<CallbackResult> {
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000 * attempt); // increasing timeout

      const resp = await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (resp.ok) {
        // Agent acknowledged
        return { success: true, attempts: attempt };
      }

      lastError = `HTTP ${resp.status}`;
    } catch (err) {
      lastError = String(err);
    }

    // Exponential backoff: 1s, 4s, 9s
    if (attempt < maxRetries) {
      await sleep(attempt * attempt * 1000);
    }
  }

  // All retries exhausted — mark as stale
  if (eventBus) {
    eventBus.publish({
      messageId: `stale_decision_${payload.decision_id}`,
      correlationId: payload.task_id,
      causationId: null,
      timestamp: new Date(),
      messageType: MessageType.SystemNotification,
      payload: {
        type: 'decision_callback_stale',
        decisionId: payload.decision_id,
        taskId: payload.task_id,
        callbackUrl,
        attempts: maxRetries,
        lastError,
      } as any,
    }).catch(() => {});
  }

  return { success: false, attempts: maxRetries, lastError };
}

// ── Task State Machine ───────────────────────────────────────────

export const VALID_TRANSITIONS: Record<TaskReliabilityStatus, TaskReliabilityStatus[]> = {
  running: ['completed', 'failed', 'timed_out'],
  completed: [],
  failed: ['awaiting_recovery'],
  timed_out: ['awaiting_recovery', 'failed'],
  awaiting_recovery: ['running', 'failed'],
  stale: [],
};

export function canTransition(from: TaskReliabilityStatus, to: TaskReliabilityStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

/** Apply a state transition, publishing via EventBus if provided. */
export function transitionTask(
  record: TaskRecord,
  newStatus: TaskReliabilityStatus,
  eventBus?: EventBus,
): TaskRecord {
  if (!canTransition(record.status, newStatus)) {
    throw new Error(`Invalid task transition: ${record.status} → ${newStatus}`);
  }
  record.status = newStatus;

  if (eventBus) {
    eventBus.publish({
      messageId: `task_status_${record.task_id}_${Date.now()}`,
      correlationId: record.task_id,
      causationId: null,
      timestamp: new Date(),
      messageType: MessageType.SystemNotification,
      payload: {
        type: 'task_updated',
        taskId: record.task_id,
        agentId: record.agent_id,
        status: newStatus,
      } as any,
    }).catch(() => {});
  }

  return record;
}

// ── Helpers ──────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
