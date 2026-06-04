//
// Slot Client — HTTP client for reading/writing the Context Slot.
//
// External agents use this to:
//   - Read the Slot (context prepared by Secretary)
//   - Write discoveries back to the Slot during execution
//   - Submit telemetry after task completion
//

import type { ContextSlot } from '@cabinet/types';

// ── Types ────────────────────────────────────────────────────────

export interface SlotClientConfig {
  /** Cabinet API base URL (e.g. 'http://localhost:3000'). */
  baseUrl: string;
  /** Task-scoped auth token (provided in task configuration). */
  taskToken: string;
  /** The task ID this client is associated with. */
  taskId: string;
  /** The agent identifier (used when submitting deliverables, decisions, telemetry). */
  agentId?: string;
}

export interface TelemetryPayload {
  model: string;
  tokens: { prompt: number; completion: number };
  timing: { ttft_ms: number; total_ms: number; tool_latency_ms: number[] };
  steps: number;
}

// ── SlotClient ───────────────────────────────────────────────────

export class SlotClient {
  private baseUrl: string;
  private taskToken: string;
  private taskId: string;
  private agentId: string;

  constructor(config: SlotClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.taskToken = config.taskToken;
    this.taskId = config.taskId;
    this.agentId = config.agentId ?? 'external';
  }

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.taskToken}`,
    };
  }

  /** Read the full Context Slot. Used at task start to understand context. */
  async readSlot(): Promise<ContextSlot> {
    const resp = await this.fetchOrThrow(`/api/slot/${this.taskId}/read`, { method: 'GET' });
    return resp.json() as Promise<ContextSlot>;
  }

  /** Write discoveries to the Slot (append). */
  async writeDiscoveries(discoveries: Array<{ type: string; summary: string; [key: string]: unknown }>): Promise<void> {
    await this.fetchOrThrow(`/api/slot/${this.taskId}/write`, {
      method: 'POST',
      body: JSON.stringify({ discoveries }),
    });
  }

  /** Write previous outputs to the Slot (append). */
  async writeOutputs(outputs: string[]): Promise<void> {
    await this.fetchOrThrow(`/api/slot/${this.taskId}/write`, {
      method: 'POST',
      body: JSON.stringify({ previous_outputs: outputs }),
    });
  }

  /** Submit a deliverable to Cabinet. */
  async submitDeliverable(title: string, content: string, type = 'code', metadata?: Record<string, unknown>): Promise<string> {
    const resp = await this.fetchOrThrow('/api/external/deliverables', {
      method: 'POST',
      body: JSON.stringify({
        agent_id: this.agentId,
        task_id: this.taskId,
        title,
        type,
        content,
        metadata,
      }),
    });
    const result = await resp.json() as { deliverable_id: string };
    return result.deliverable_id;
  }

  /** Submit a decision request to Cabinet (await Captain approval). */
  async requestDecision(params: {
    title: string;
    description: string;
    urgency?: 'red' | 'yellow' | 'green';
    options: Array<{ label: string; value: string }>;
  }): Promise<{ decision_id: string; status: string }> {
    const resp = await this.fetchOrThrow('/api/external/decisions', {
      method: 'POST',
      body: JSON.stringify({
        type: 'execution',
        title: params.title,
        description: params.description,
        urgency: params.urgency ?? 'yellow',
        source: { agent_id: this.agentId, task_id: this.taskId },
        options: params.options,
      }),
    });
    return resp.json() as Promise<{ decision_id: string; status: string }>;
  }

  /** Report telemetry after task completion. */
  async reportTelemetry(agentId: string, payload: TelemetryPayload): Promise<void> {
    await this.fetchOrThrow('/api/telemetry/report', {
      method: 'POST',
      body: JSON.stringify({
        task_id: this.taskId,
        agent_id: agentId,
        ...payload,
        status: 'completed',
      }),
    });
  }

  private async fetchOrThrow(url: string, init: RequestInit): Promise<Response> {
    const resp = await fetch(`${this.baseUrl}${url}`, { ...init, headers: { ...this.headers, ...(init.headers as Record<string, string> ?? {}) } });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`SlotClient HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }
    return resp;
  }
}
