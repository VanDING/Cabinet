//
// A2A Connector — HTTP client for A2A-compatible agents.
//
// Implements the Agent-to-Agent protocol (Google-defined):
//   - GET  /.well-known/agent.json  → capability discovery
//   - POST /a2a/tasks               → task dispatch
//   - GET  /a2a/tasks/{id}          → task status polling
//   - POST /a2a/tasks/{id}/cancel   → task cancellation
//
// WebSocket connection to Cabinet is managed separately (Phase 2.6).
//

import type {
  ExternalAgentAdapter,
  ExternalTask,
  ExternalTaskResult,
  AgentCapability,
  A2AAgentConfig,
} from './types.js';

// ── Constants ────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;

// ── A2A Wire Types ───────────────────────────────────────────────

interface A2AAgentCard {
  agent_id: string;
  display_name: string;
  version: string;
  capabilities: AgentCapability[];
  connection: {
    protocol: 'a2a';
    base_url: string;
    health_check?: string;
    authentication?: { type: string; header?: string; envVar?: string };
  };
}

interface A2ATaskRequest {
  task_id: string;
  session_id: string;
  capability: string;
  input: unknown;
  slot: Record<string, unknown>;
  configuration: { max_retries: number; timeout_ms: number; slot_write_url: string };
}

interface A2ATaskResponse {
  task_id: string;
  status: 'accepted' | 'rejected';
  estimated_duration_ms?: number;
  error?: string;
}

interface A2ATaskStatus {
  task_id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
  message?: string;
  output?: unknown;
  tokens_used?: number;
  model?: string;
  timestamp: string;
}

// ── A2AConnector ─────────────────────────────────────────────────

export class A2AConnector implements ExternalAgentAdapter {
  readonly protocol = 'a2a' as const;
  private caps: AgentCapability[] = [];
  private running = false;
  private ws: any = null;
  private wsUrl: string | null = null;
  private taskStatusCallbacks = new Map<string, (status: A2ATaskStatus) => void>();

  constructor(
    readonly agentId: string,
    private config: A2AAgentConfig,
    private logger?: { info: (msg: string, ctx?: unknown) => void; warn: (msg: string, ctx?: unknown) => void },
  ) {}

  /** Connect to Cabinet's WebSocket for real-time status + approval events. */
  connectWebSocket(cabinetWsUrl: string): void {
    this.wsUrl = cabinetWsUrl;
    try {
      this.ws = new (globalThis as any).WebSocket(cabinetWsUrl);
      this.ws.onopen = () => {
        this.ws.send(JSON.stringify({ type: 'agent_connect', agent_id: this.agentId }));
        this.logger?.info(`A2A agent ${this.agentId} WebSocket connected`, { url: cabinetWsUrl });
      };
      this.ws.onmessage = (msg: any) => {
        try {
          const data = JSON.parse(msg.data as string);
          if (data.type === 'decision_result') {
            this.logger?.info(`A2A agent ${this.agentId} received decision result`, data);
          }
          if (data.type === 'task_status' && data.task_id) {
            const cb = this.taskStatusCallbacks.get(data.task_id);
            if (cb) cb(data as A2ATaskStatus);
          }
        } catch { /* ignore */ }
      };
      this.ws.onclose = () => { this.ws = null; };
      this.ws.onerror = () => { this.ws?.close(); };
    } catch {
      this.ws = null;
    }
  }

  async start(): Promise<void> {
    try {
      this.caps = await this.discoverCapabilities();
      this.running = true;
      // Auto-connect WebSocket if Cabinet URL is available
      if (!this.ws && this.wsUrl) this.connectWebSocket(this.wsUrl);
      this.logger?.info(`A2A agent ${this.agentId} connected`, { baseUrl: this.config.baseUrl, caps: this.caps.length });
    } catch (err) {
      this.logger?.warn(`A2A agent ${this.agentId} not reachable`, { error: String(err) });
      this.running = false;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
  }

  async healthCheck(): Promise<boolean> {
    if (this.config.healthCheckUrl) {
      try {
        const resp = await this.fetchWithTimeout(this.config.healthCheckUrl, { method: 'GET' }, 5_000);
        return resp.ok;
      } catch {
        return false;
      }
    }
    return this.running;
  }

  // ── Capability Discovery ──────────────────────────────────────

  async discoverCapabilities(): Promise<AgentCapability[]> {
    const url = `${this.config.baseUrl}/.well-known/agent.json`;
    const resp = await this.fetchWithTimeout(url, { method: 'GET' }, 10_000);
    if (!resp.ok) {
      throw new Error(`Failed to discover capabilities: HTTP ${resp.status}`);
    }
    const card = (await resp.json()) as A2AAgentCard;
    this.caps = card.capabilities ?? [];
    return this.caps;
  }

  // ── Task Dispatch ─────────────────────────────────────────────

  async dispatchTask(task: ExternalTask): Promise<ExternalTaskResult> {
    const timeoutMs = this.config.timeoutMs ?? task.configuration.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const startedAt = new Date().toISOString();

    try {
      // Step 1: Send task
      const taskUrl = `${this.config.baseUrl}/a2a/tasks`;
      const taskBody: A2ATaskRequest = {
        task_id: task.task_id,
        session_id: task.session_id,
        capability: task.capability,
        input: task.input,
        slot: task.slot as unknown as Record<string, unknown>,
        configuration: {
          max_retries: task.configuration.max_retries ?? DEFAULT_MAX_RETRIES,
          timeout_ms: timeoutMs,
          slot_write_url: task.configuration.slot_write_url,
        },
      };
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.config.authConfig?.header && this.config.authConfig?.envVar) {
        const token = process.env[this.config.authConfig.envVar];
        if (token) headers[this.config.authConfig.header] = token;
      }

      const resp = await this.fetchWithTimeout(
        taskUrl,
        { method: 'POST', headers, body: JSON.stringify(taskBody) },
        timeoutMs,
      );

      if (!resp.ok) {
        return {
          task_id: task.task_id,
          status: 'failed',
          error: `A2A task rejected: HTTP ${resp.status}`,
          audit: { started_at: startedAt, completed_at: new Date().toISOString() },
        };
      }

      const accepted = (await resp.json()) as A2ATaskResponse;
      if (accepted.status === 'rejected') {
        return {
          task_id: task.task_id,
          status: 'failed',
          error: accepted.error ?? 'Task rejected by agent',
          audit: { started_at: startedAt, completed_at: new Date().toISOString() },
        };
      }

      // Step 2: Poll for completion with exponential backoff
      let pollMs = 1000; // Start at 1s
      const maxPollMs = 10_000; // Cap at 10s
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await sleep(pollMs);
        const statusResp = await this.fetchWithTimeout(
          `${this.config.baseUrl}/a2a/tasks/${task.task_id}`,
          { method: 'GET', headers },
          5_000,
        );
        if (!statusResp.ok) { pollMs = Math.min(pollMs * 2, maxPollMs); continue; }
        const status = (await statusResp.json()) as A2ATaskStatus;

        if (status.status === 'completed') {
          return {
            task_id: task.task_id,
            status: 'completed',
            output: status.output,
            audit: {
              started_at: startedAt,
              completed_at: new Date().toISOString(),
              tokens_used: status.tokens_used,
              model: status.model,
            },
          };
        }
        if (status.status === 'failed' || status.status === 'cancelled') {
          return {
            task_id: task.task_id,
            status: 'failed',
            error: `A2A task ${status.status}: ${status.message ?? ''}`,
            audit: { started_at: startedAt, completed_at: new Date().toISOString() },
          };
        }
        // Task still in progress — increase poll interval with backoff
        pollMs = Math.min(pollMs * 2, maxPollMs);
      }

      return {
        task_id: task.task_id,
        status: 'timed_out',
        error: `A2A task timed out after ${timeoutMs}ms`,
        audit: { started_at: startedAt, completed_at: new Date().toISOString() },
      };
    } catch (err) {
      return {
        task_id: task.task_id,
        status: 'failed',
        error: String(err),
        audit: { started_at: startedAt, completed_at: new Date().toISOString() },
      };
    }
  }

  async cancelTask(taskId: string): Promise<void> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      await this.fetchWithTimeout(
        `${this.config.baseUrl}/a2a/tasks/${taskId}/cancel`,
        { method: 'POST', headers },
        5_000,
      );
    } catch {
      // Best-effort cancellation
    }
  }

  // ── Capabilities ──────────────────────────────────────────────

  getCapabilities(): AgentCapability[] {
    return this.caps;
  }

  // ── Helpers ───────────────────────────────────────────────────

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
