//
// TriggerExecutor — fires autopilot triggers and records runs.
//
// When a trigger fires (cron expiry, webhook hit, manual), the executor:
//   1. Validates the trigger is still enabled
//   2. Renders the input_template with variable substitution
//   3. Enqueues a task via AgentDaemon
//   4. Records the run in autopilot_runs
//

import crypto from 'node:crypto';
import type { AutopilotRepository, AutopilotTriggerRow } from '@cabinet/storage';
import type { AgentDaemon } from '../agent-daemon.js';

export class TriggerExecutor {
  constructor(
    private readonly repo: AutopilotRepository,
    private readonly daemon: AgentDaemon,
  ) {}

  /** Fire a trigger by its database row. */
  async fire(trigger: AutopilotTriggerRow): Promise<{ runId: string; taskId: string }> {
    if (!trigger.enabled) throw new Error(`Trigger ${trigger.id} is disabled`);

    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const input = this.renderTemplate(trigger.input_template);

    // Enqueue the task
    const taskId = await this.daemon.enqueueTask({
      agentId: trigger.target_agent_id,
      sessionId: `autopilot_${trigger.id}`,
      capability: 'default',
      input,
      slot: this.buildSlot(trigger),
      maxRetries: trigger.max_retries,
      timeoutMs: trigger.timeout_ms,
    });

    // Record run
    this.repo.createRun({
      id: runId,
      trigger_id: trigger.id,
      task_id: taskId,
      trigger_type: trigger.trigger_type,
      status: 'pending',
      started_at: new Date().toISOString(),
      error_message: null,
    });

    return { runId, taskId };
  }

  /** Fire a webhook trigger with payload and HMAC signature verification. */
  async fireWebhook(
    token: string,
    payload: Record<string, unknown>,
    signature?: string,
  ): Promise<{ runId: string; taskId: string }> {
    const trigger = this.repo.findByWebhookToken(token);
    if (!trigger) throw new Error('Webhook token not found or trigger disabled');

    // Verify HMAC signature if secret is configured
    if (trigger.webhook_secret && signature) {
      const body = JSON.stringify(payload);
      const expected = crypto.createHmac('sha256', trigger.webhook_secret).update(body).digest('hex');
      if (signature !== `sha256=${expected}`) {
        throw new Error('Invalid webhook signature');
      }
    }

    // Merge webhook payload into input template
    const input = this.renderTemplate(trigger.input_template, payload);

    // Update last called timestamp
    this.repo.update(trigger.id, { webhook_last_called_at: new Date().toISOString() });

    // Enqueue the task
    const taskId = await this.daemon.enqueueTask({
      agentId: trigger.target_agent_id,
      sessionId: `webhook_${trigger.id}`,
      capability: 'default',
      input,
      slot: this.buildSlot(trigger),
      maxRetries: trigger.max_retries,
      timeoutMs: trigger.timeout_ms,
    });

    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.repo.createRun({
      id: runId,
      trigger_id: trigger.id,
      task_id: taskId,
      trigger_type: 'webhook',
      status: 'pending',
      started_at: new Date().toISOString(),
      error_message: null,
    });

    return { runId, taskId };
  }

  /** Retry a failed run. */
  async retryRun(runId: string): Promise<string> {
    const run = this.repo.findRunById(runId);
    if (!run) throw new Error('Run not found');
    if (run.status !== 'failed') throw new Error(`Run status is ${run.status}, not failed`);

    const trigger = this.repo.findById(run.trigger_id);
    if (!trigger) throw new Error('Trigger not found');

    const taskId = await this.daemon.enqueueTask({
      agentId: trigger.target_agent_id,
      sessionId: `retry_${trigger.id}`,
      capability: 'default',
      input: this.renderTemplate(trigger.input_template),
      slot: this.buildSlot(trigger),
      maxRetries: trigger.max_retries,
      timeoutMs: trigger.timeout_ms,
    });

    const newRunId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.repo.createRun({
      id: newRunId,
      trigger_id: trigger.id,
      task_id: taskId,
      trigger_type: run.trigger_type,
      status: 'pending',
      started_at: new Date().toISOString(),
      error_message: null,
    });

    return taskId;
  }

  /** Get run history for a trigger. */
  getRunHistory(triggerId: string, limit = 50) {
    return this.repo.findRunsByTrigger(triggerId, limit);
  }

  // ── Internal ──

  private renderTemplate(template: string, extraVars?: Record<string, unknown>): string {
    const vars: Record<string, string> = {
      '{{timestamp}}': new Date().toISOString(),
      '{{date}}': new Date().toISOString().slice(0, 10),
      '{{time}}': new Date().toTimeString().slice(0, 8),
    };
    if (extraVars) {
      for (const [k, v] of Object.entries(extraVars)) {
        vars[`{{${k}}}`] = String(v);
      }
    }
    let rendered = template;
    for (const [key, value] of Object.entries(vars)) {
      rendered = rendered.replaceAll(key, value);
    }
    return rendered || 'Execute the assigned task.';
  }

  private buildSlot(trigger: AutopilotTriggerRow) {
    return {
      project: { name: trigger.workspace_id, goals: [] },
      memories: [],
      preferences: {},
      files: [],
      discoveries: [],
      previous_outputs: [],
      security: { level: 'L1', maxRetries: trigger.max_retries },
    };
  }
}
