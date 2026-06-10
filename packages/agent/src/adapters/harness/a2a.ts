//
// A2A HarnessRuntime — first-class Agent-to-Agent protocol adapter.
//
// Upgrades the existing A2AConnector (HTTP polling) to a first-class
// HarnessRuntime with:
//   - WebSocket bidirectional communication (replaces HTTP polling)
//   - HarnessSkill injection for A2A agents
//   - Auto-discovery support (scans agents/ directory for agent.json)
//   - Structured context passing via the A2A wire format
//
// The A2A protocol (Google-defined) uses:
//   - GET  /.well-known/agent.json  → capability discovery
//   - POST /a2a/tasks               → task dispatch
//   - WebSocket (Cabinet extension) → real-time status + skill injection
//

import type {
  ExternalAgentAdapter,
  ExternalTask,
  ExternalTaskResult,
  AgentCapability,
  A2AAgentConfig,
} from '../types.js';
import type { HarnessRuntime, HarnessContext, AgentTaskMetrics, HarnessConfig } from '../harness-runtime.js';

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
  // Cabinet extension: harness context for skill injection
  cabinet_context?: {
    harnessId: string;
    skillInjected: boolean;
    working_directory?: string;
  };
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

// ── A2AHarnessRuntime ────────────────────────────────────────────

export class A2AHarnessRuntime implements HarnessRuntime {
  readonly harnessId = 'a2a';
  readonly protocol = 'a2a' as const;
  private caps: AgentCapability[] = [];
  private running = false;
  private ws: WebSocket | null = null;
  private taskStatusCallbacks = new Map<string, (status: A2ATaskStatus) => void>();

  constructor(
    readonly agentId: string,
    private config: HarnessConfig,
    private logger?: { info: (msg: string, ctx?: unknown) => void; warn: (msg: string, ctx?: unknown) => void },
  ) {}

  // ── Lifecycle ─────────────────────────────────────────────────

  async start(): Promise<void> {
    try {
      this.caps = await this.discoverCapabilities();
      this.running = true;
      this.logger?.info(`A2A agent ${this.agentId} connected`, {
        baseUrl: this.config.baseUrl,
        caps: this.caps.length,
      });
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

  async detect(): Promise<boolean> {
    try {
      await this.discoverCapabilities();
      return true;
    } catch {
      return false;
    }
  }

  // ── WebSocket (bidirectional, replaces HTTP polling) ──────────

  /** Connect to Cabinet's WebSocket for real-time bidirectional communication. */
  connectWebSocket(cabinetWsUrl: string): void {
    try {
      const WS = (globalThis as any).WebSocket;
      if (!WS) {
        this.logger?.warn('WebSocket not available in this environment');
        return;
      }
      const ws = new WS(cabinetWsUrl);
      this.ws = ws;
      ws.onopen = () => {
        // Register with Cabinet server
        ws.send(JSON.stringify({
          type: 'agent_connect',
          agent_id: this.agentId,
          harness_id: this.harnessId,
          capabilities: this.caps.map((c) => c.name),
        }));
        this.logger?.info(`A2A agent ${this.agentId} WebSocket connected`);
      };
      ws.onmessage = (msg: any) => {
        try {
          const data = JSON.parse(msg.data as string);
          if (data.type === 'task_assigned' && data.task) {
            this.logger?.info(`A2A agent ${this.agentId} received task via WS`, { taskId: data.task.task_id });
          }
          if (data.type === 'task_status' && data.task_id) {
            const cb = this.taskStatusCallbacks.get(data.task_id);
            if (cb) cb(data as A2ATaskStatus);
          }
          if (data.type === 'skill_injected') {
            this.logger?.info(`A2A agent ${this.agentId} received skill injection`);
          }
        } catch { /* ignore malformed messages */ }
      };
      ws.onclose = () => {
        this.ws = null;
        this.logger?.warn(`A2A agent ${this.agentId} WebSocket disconnected`);
      };
      ws.onerror = () => {
        ws.close();
      };
    } catch (err) {
      this.logger?.warn(`A2A agent ${this.agentId} WebSocket connection failed`, { error: String(err) });
      this.ws = null;
    }
  }

  /** Check if WebSocket is currently connected. */
  isWebSocketConnected(): boolean {
    const ws = this.ws;
    return ws !== null && ws.readyState === 1; // WebSocket.OPEN
  }

  /** Send a message via WebSocket (if connected). */
  sendWSMessage(message: Record<string, unknown>): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return false;
    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  // ── Capability Discovery ──────────────────────────────────────

  async discoverCapabilities(): Promise<AgentCapability[]> {
    const baseUrl = this.config.baseUrl;
    if (!baseUrl) throw new Error('No base URL configured for A2A agent');

    const url = `${baseUrl}/.well-known/agent.json`;
    const resp = await this.fetchWithTimeout(url, { method: 'GET' }, 10_000);
    if (!resp.ok) {
      throw new Error(`Failed to discover capabilities: HTTP ${resp.status}`);
    }
    const card = (await resp.json()) as A2AAgentCard;
    this.caps = card.capabilities ?? [];
    return this.caps;
  }

  // ── Prompt Conversion ─────────────────────────────────────────
  //
  // A2A agents communicate via structured JSON, not raw text prompts.
  // convertPrompt returns a JSON-serializable task structure.

  convertPrompt(task: ExternalTask, context?: HarnessContext): string {
    const slotJson: Record<string, unknown> = {
      project: task.slot.project ? {
        name: task.slot.project.name,
        tech_stack: task.slot.project.tech_stack,
        goals: task.slot.project.goals,
      } : undefined,
      memories: task.slot.memories,
      files: task.slot.files,
      security: task.slot.security,
      preferences: task.slot.preferences,
    };

    // Inject harness context for skill awareness
    if (context) {
      slotJson._cabinet_harness = {
        harnessId: context.harnessId,
        outputFormat: context.outputFormat,
        workspacePath: context.workspacePath,
      };
    }

    return JSON.stringify({
      task_id: task.task_id,
      session_id: task.session_id,
      capability: task.capability,
      input: task.input,
      slot: slotJson,
      skill: this.injectSkill(),
    }, null, 2);
  }

  // ── Output Parsing ────────────────────────────────────────────

  parseOutput(stdout: string, _stderr: string, taskId: string, startedAt: string): ExternalTaskResult {
    try {
      const parsed = JSON.parse(stdout) as A2ATaskStatus;
      return {
        task_id: taskId,
        status: parsed.status === 'completed' ? 'completed' : 'failed',
        output: parsed.output ?? stdout,
        audit: {
          started_at: startedAt,
          completed_at: parsed.timestamp ?? new Date().toISOString(),
          tokens_used: parsed.tokens_used,
          model: parsed.model,
        },
      };
    } catch {
      return {
        task_id: taskId,
        status: 'completed',
        output: stdout,
        audit: {
          started_at: startedAt,
          completed_at: new Date().toISOString(),
        },
      };
    }
  }

  extractMetrics(_stdout: string, stderr: string): AgentTaskMetrics {
    const metrics: AgentTaskMetrics = {};
    try {
      const parsed = JSON.parse(stderr || '{}');
      if (parsed.tokens_used) metrics.tokensUsed = parsed.tokens_used;
      if (parsed.model) metrics.model = parsed.model;
      if (parsed.tool_calls) metrics.toolCalls = parsed.tool_calls;
      if (parsed.duration_ms) metrics.durationMs = parsed.duration_ms;
    } catch { /* not JSON */ }
    return metrics;
  }

  // ── Skill Injection ───────────────────────────────────────────

  injectSkill(): string {
    return [
      '# Cabinet Agent Protocol (A2A Edition)',
      '',
      'You are an A2A-compatible agent running inside the **Cabinet AI orchestration framework**.',
      '',
      '## Communication',
      '- Tasks arrive via the A2A protocol (POST /a2a/tasks or WebSocket push).',
      '- Report progress via WebSocket (real-time) or the status polling endpoint.',
      '- Cabinet extends the standard A2A protocol with a `cabinet_context` field containing harness metadata.',
      '',
      '## Context Slot',
      'Each task includes a `slot` with:',
      '- Project information (name, tech stack, goals)',
      '- Relevant memories from Cabinet\'s knowledge base',
      '- File references the user has been working with',
      '- Security constraints and user preferences',
      '',
      '## Deliverables',
      '- Set task output to your final result.',
      '- Include structured data when applicable (JSON, code blocks, file paths).',
      '- Report token usage and model info for cost tracking.',
      '',
      '## Best Practices',
      '- Leverage the context slot to understand project goals.',
      '- Use WebSocket for real-time progress updates when available.',
      '- Handle errors gracefully and report them clearly.',
    ].join('\n');
  }

  // ── Task Dispatch ─────────────────────────────────────────────

  async dispatchTask(task: ExternalTask): Promise<ExternalTaskResult> {
    const timeoutMs = this.config.timeoutMs ?? task.configuration.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const startedAt = new Date().toISOString();
    const baseUrl = this.config.baseUrl;
    if (!baseUrl) {
      return {
        task_id: task.task_id,
        status: 'failed',
        error: 'No base URL configured for A2A agent',
        audit: { started_at: startedAt, completed_at: new Date().toISOString() },
      };
    }

    try {
      const taskUrl = `${baseUrl}/a2a/tasks`;
      const slotJson = task.slot as unknown as Record<string, unknown>;

      const taskBody: A2ATaskRequest = {
        task_id: task.task_id,
        session_id: task.session_id,
        capability: task.capability,
        input: task.input,
        slot: slotJson,
        configuration: {
          max_retries: task.configuration.max_retries ?? DEFAULT_MAX_RETRIES,
          timeout_ms: timeoutMs,
          slot_write_url: task.configuration.slot_write_url,
        },
        // Cabinet extension: inject harness context
        cabinet_context: {
          harnessId: this.harnessId,
          skillInjected: true,
          working_directory: task.configuration.working_directory,
        },
      };

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.config.authConfig?.header && this.config.authConfig?.envVar) {
        const token = process.env[this.config.authConfig.envVar];
        if (token) headers[this.config.authConfig.header] = token;
      }

      // Step 1: Submit task
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

      // Step 2: If WebSocket is connected, wait for WS status updates
      // Otherwise fall back to HTTP polling
      if (this.isWebSocketConnected()) {
        return await this.waitForWSCompletion(task.task_id, startedAt, timeoutMs);
      }

      return await this.pollForCompletion(task.task_id, startedAt, timeoutMs, headers, baseUrl);
    } catch (err) {
      return {
        task_id: task.task_id,
        status: 'failed',
        error: String(err),
        audit: { started_at: startedAt, completed_at: new Date().toISOString() },
      };
    }
  }

  /** Wait for task completion via WebSocket events. */
  private waitForWSCompletion(
    taskId: string,
    startedAt: string,
    timeoutMs: number,
  ): Promise<ExternalTaskResult> {
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;

      const callback = (status: A2ATaskStatus) => {
        if (status.status === 'completed') {
          this.taskStatusCallbacks.delete(taskId);
          resolve({
            task_id: taskId,
            status: 'completed',
            output: status.output,
            audit: {
              started_at: startedAt,
              completed_at: new Date().toISOString(),
              tokens_used: status.tokens_used,
              model: status.model,
            },
          });
        } else if (status.status === 'failed' || status.status === 'cancelled') {
          this.taskStatusCallbacks.delete(taskId);
          resolve({
            task_id: taskId,
            status: 'failed',
            error: `A2A task ${status.status}: ${status.message ?? ''}`,
            audit: { started_at: startedAt, completed_at: new Date().toISOString() },
          });
        }
      };

      this.taskStatusCallbacks.set(taskId, callback);

      // Fallback timeout: if WS doesn't deliver, fail with timeout
      const remaining = deadline - Date.now();
      setTimeout(() => {
        if (this.taskStatusCallbacks.has(taskId)) {
          this.taskStatusCallbacks.delete(taskId);
          resolve({
            task_id: taskId,
            status: 'timed_out',
            error: `A2A task timed out after ${timeoutMs}ms (WS mode)`,
            audit: { started_at: startedAt, completed_at: new Date().toISOString() },
          });
        }
      }, Math.max(remaining, 1000));
    });
  }

  /** HTTP polling fallback for task completion. */
  private async pollForCompletion(
    taskId: string,
    startedAt: string,
    timeoutMs: number,
    headers: Record<string, string>,
    baseUrl: string,
  ): Promise<ExternalTaskResult> {
    let pollMs = 1000;
    const maxPollMs = 10_000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await sleep(pollMs);
      try {
        const statusResp = await this.fetchWithTimeout(
          `${baseUrl}/a2a/tasks/${taskId}`,
          { method: 'GET', headers },
          5_000,
        );
        if (!statusResp.ok) { pollMs = Math.min(pollMs * 2, maxPollMs); continue; }

        const status = (await statusResp.json()) as A2ATaskStatus;

        if (status.status === 'completed') {
          return {
            task_id: taskId,
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
            task_id: taskId,
            status: 'failed',
            error: `A2A task ${status.status}: ${status.message ?? ''}`,
            audit: { started_at: startedAt, completed_at: new Date().toISOString() },
          };
        }
        pollMs = Math.min(pollMs * 2, maxPollMs);
      } catch {
        pollMs = Math.min(pollMs * 2, maxPollMs);
      }
    }

    return {
      task_id: taskId,
      status: 'timed_out',
      error: `A2A task timed out after ${timeoutMs}ms`,
      audit: { started_at: startedAt, completed_at: new Date().toISOString() },
    };
  }

  async cancelTask(taskId: string): Promise<void> {
    const baseUrl = this.config.baseUrl;
    if (!baseUrl) return;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      await this.fetchWithTimeout(
        `${baseUrl}/a2a/tasks/${taskId}/cancel`,
        { method: 'POST', headers },
        5_000,
      );
    } catch {
      // Best-effort cancellation
    }
  }

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

/** Backward-compatible alias for {@link A2AHarnessRuntime}.
 *  Prefer {@link HarnessRuntimeFactory} for new code.
 *  @deprecated Use A2AHarnessRuntime or HarnessRuntimeFactory directly.
 */
export class A2AConnector extends A2AHarnessRuntime implements ExternalAgentAdapter {
  constructor(
    agentId: string,
    config: A2AAgentConfig,
    logger?: { info: (msg: string, ctx?: unknown) => void; warn: (msg: string, ctx?: unknown) => void },
  ) {
    super(agentId, { ...(config as unknown as HarnessConfig), harnessId: 'a2a' }, logger);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
