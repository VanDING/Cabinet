//
// AgentDaemon — core daemon runtime for pull-mode agent task execution.
//
// Embedded in the server process. Manages:
//   - Task queue (enqueue / claim / execute / complete / fail)
//   - Heartbeat (periodic liveness reporting)
//   - Orphan recovery (reset stale claimed tasks)
//   - Workspace GC (delegated to WorkspaceManager)
//   - Auto-discovery (delegated to AutoDiscoverer)
//   - Adapter caching (one CliAdapter/A2AConnector per agent ID)
//
// Push-mode (existing Secretary dispatch) is preserved as fallback.
//

import { hostname } from 'node:os';
import type { ContextSlot, TaskQueueEntry, TaskQueueStatus, DaemonStatus, DaemonAgentInfo } from '@cabinet/types';
import type {
  AgentTaskQueueRepository,
  AgentDaemonRepository,
} from '@cabinet/storage';
import type { AgentRoleRegistry } from '../agent-roles.js';
import { CliAdapter } from '../adapters/cli-adapter.js';
import { A2AConnector } from '../adapters/a2a-connector.js';
import type { ExternalAgentAdapter } from '../adapters/types.js';
import { TaskQueuePoller } from './task-queue-poller.js';
import { WorkspaceManager } from './workspace-manager.js';
import { AutoDiscoverer, type DiscoveryResult } from './auto-discoverer.js';
import { SquadRepository } from '@cabinet/storage';
import { SquadRouter } from './squad/squad-router.js';

// ── Config ────────────────────────────────────────────────────────

export interface AgentDaemonOptions {
  daemonId?: string;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  maxConcurrentTasks?: number;
  taskTimeoutMs?: number;
  workspaceTtlMs?: number;
  autoDiscoverOnStart?: boolean;
}

const DEFAULTS: Required<AgentDaemonOptions> = {
  daemonId: `daemon_${hostname()}`,
  pollIntervalMs: 3000,
  heartbeatIntervalMs: 15_000,
  heartbeatTimeoutMs: 60_000,
  maxConcurrentTasks: 3,
  taskTimeoutMs: 300_000,
  workspaceTtlMs: 86_400_000,
  autoDiscoverOnStart: true,
};

// ── AgentDaemon ────────────────────────────────────────────────────

export class AgentDaemon {
  private opts: Required<AgentDaemonOptions>;
  private poller: TaskQueuePoller;
  private workspaceManager: WorkspaceManager;
  private discoverer: AutoDiscoverer;
  private adapterCache = new Map<string, ExternalAgentAdapter>();
  private activeTasks = new Map<string, ExternalAgentAdapter>(); // taskId → adapter
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private orphanRecoveryTimer: ReturnType<typeof setInterval> | null = null;
  private workspaceGCTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt: number = Date.now();
  private completedCount = 0;
  private failedCount = 0;
  private wsClient: import('./ws-daemon-client.js').WSDaemonClient | null = null;
  private squadRouter: SquadRouter | null = null;
  private logger: { info: (msg: string, ctx?: unknown) => void; warn: (msg: string, ctx?: unknown) => void; error: (msg: string, ctx?: unknown) => void };

  constructor(
    private readonly taskRepo: AgentTaskQueueRepository,
    private readonly daemonRepo: AgentDaemonRepository,
    private readonly registry: AgentRoleRegistry,
    options: AgentDaemonOptions = {},
    logger?: AgentDaemon['logger'],
  ) {
    this.opts = { ...DEFAULTS, ...options };
    this.logger = logger ?? {
      info: (...args: unknown[]) => console.log('[AgentDaemon]', ...args),
      warn: (...args: unknown[]) => console.warn('[AgentDaemon]', ...args),
      error: (...args: unknown[]) => console.error('[AgentDaemon]', ...args),
    };
    this.workspaceManager = new WorkspaceManager(daemonRepo, {
      fullCleanupTtlMs: this.opts.workspaceTtlMs,
    });
    this.discoverer = new AutoDiscoverer(registry);
    this.poller = new TaskQueuePoller(() => this.claimAndExecute(), {
      pollIntervalMs: this.opts.pollIntervalMs,
    });
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  async start(): Promise<DiscoveryResult[]> {
    this.startedAt = Date.now();

    // Auto-discover agents
    let discovered: DiscoveryResult[] = [];
    if (this.opts.autoDiscoverOnStart) {
      discovered = await this.discoverer.discover();
      this.logger.info('Agent discovery complete', { count: discovered.length });
    }

    // Start periodic tasks
    this.startHeartbeat();
    this.poller.start();
    this.orphanRecoveryTimer = setInterval(() => this.recoverOrphanedTasks(), 60_000);
    this.workspaceGCTimer = setInterval(() => this.workspaceManager.runGC(), 1_800_000);
    // Unref timers so they don't block process exit
    this.orphanRecoveryTimer?.unref?.();
    this.workspaceGCTimer?.unref?.();

    this.logger.info('AgentDaemon started', { daemonId: this.opts.daemonId });
    return discovered;
  }

  async stop(): Promise<void> {
    // Cancel all active tasks
    for (const [taskId, adapter] of this.activeTasks) {
      try { await adapter.cancelTask?.(taskId); } catch { /* best-effort */ }
    }
    this.activeTasks.clear();

    // Stop timers
    this.poller.stop();
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.orphanRecoveryTimer) { clearInterval(this.orphanRecoveryTimer); this.orphanRecoveryTimer = null; }
    if (this.workspaceGCTimer) { clearInterval(this.workspaceGCTimer); this.workspaceGCTimer = null; }

    // Final heartbeat + mark offline
    try {
      this.daemonRepo.upsertHeartbeat(this.opts.daemonId, '__daemon__', 'offline');
    } catch { /* DB may already be closed */ }

    // Close adapters
    for (const adapter of this.adapterCache.values()) {
      try { await adapter.stop(); } catch { /* best-effort */ }
    }
    this.adapterCache.clear();

    this.logger.info('AgentDaemon stopped', { daemonId: this.opts.daemonId });
  }

  // ── Task Queue ─────────────────────────────────────────────────

  /** Enqueue a task for async execution. Returns the task ID. */
  async enqueueTask(params: {
    agentId: string;
    sessionId: string;
    capability?: string;
    input: unknown;
    slot: ContextSlot;
    priority?: number;
    maxRetries?: number;
    timeoutMs?: number;
  }): Promise<string> {
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.taskRepo.enqueue({
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
      timeout_ms: params.timeoutMs ?? this.opts.taskTimeoutMs,
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
    this.logger.info('Task enqueued', { taskId: id, agentId: params.agentId });
    return id;
  }

  /** Check if the daemon has an adapter for the given agent. */
  hasAgent(agentId: string): boolean {
    return this.getAdapter(agentId) !== null;
  }

  /** Cancel a pending or claimed task. */
  cancelTask(taskId: string): boolean {
    const row = this.taskRepo.findById(taskId);
    if (!row) return false;
    if (row.status === 'completed' || row.status === 'cancelled') return false;

    if (row.status === 'running') {
      const adapter = this.activeTasks.get(taskId);
      if (adapter) {
        adapter.cancelTask?.(taskId).catch(() => {});
        this.activeTasks.delete(taskId);
      }
    }

    this.taskRepo.updateStatus(taskId, 'cancelled');
    this.logger.info('Task cancelled', { taskId });
    return true;
  }

  /** Retry a failed task. */
  retryTask(taskId: string): TaskQueueEntry | null {
    const row = this.taskRepo.retryTask(taskId);
    if (!row) return null;
    this.logger.info('Task retried', { taskId });
    return this.rowToEntry(row);
  }

  /** Get task by ID. */
  getTask(taskId: string): TaskQueueEntry | null {
    const row = this.taskRepo.findById(taskId);
    return row ? this.rowToEntry(row) : null;
  }

  /** List tasks with optional filters. */
  listTasks(filter?: { status?: string; agentId?: string; limit?: number }): TaskQueueEntry[] {
    if (filter?.agentId && filter?.status) {
      return this.taskRepo.findByAgent(filter.agentId, filter.status, filter.limit).map((r) => this.rowToEntry(r));
    }
    if (filter?.status) {
      return this.taskRepo.findByStatus(filter.status, filter.limit).map((r) => this.rowToEntry(r));
    }
    if (filter?.agentId) {
      return this.taskRepo.findByAgent(filter.agentId, undefined, filter.limit).map((r) => this.rowToEntry(r));
    }
    return this.taskRepo.findByStatus(['pending', 'claimed', 'running'], filter?.limit ?? 50).map((r) => this.rowToEntry(r));
  }

  /** Get daemon status. */
  getStatus(): DaemonStatus {
    const agents: DaemonAgentInfo[] = [];
    const discovered = this.discoverer.getLastResults();
    for (const d of discovered) {
      const counts = this.taskRepo.countByStatus(d.agentId);
      agents.push({
        agentId: d.agentId,
        command: d.command ?? d.baseUrl ?? 'unknown',
        detected: d.detected,
        status: 'online',
        activeTaskCount: (counts.running ?? 0) + (counts.claimed ?? 0),
        lastHeartbeatAt: null,
      });
    }
    return {
      daemonId: this.opts.daemonId,
      status: 'online',
      uptimeMs: Date.now() - this.startedAt,
      activeTaskCount: this.activeTasks.size,
      completedTaskCount: this.completedCount,
      failedTaskCount: this.failedCount,
      agents,
    };
  }

  /** Get discovered agents. */
  getDiscoveredAgents(): DiscoveryResult[] {
    return this.discoverer.getLastResults();
  }

  /** Trigger rediscovery. */
  async triggerDiscovery(): Promise<DiscoveryResult[]> {
    return this.discoverer.discover();
  }

  /** Trigger workspace GC. */
  runWorkspaceGC(): ReturnType<WorkspaceManager['runGC']> {
    return this.workspaceManager.runGC();
  }

  /** Set WS client for real-time progress reporting. */
  setWSClient(client: import('./ws-daemon-client.js').WSDaemonClient): void {
    this.wsClient = client;
  }

  /** Set squad router for team-based task routing. */
  setSquadRouter(db: import('better-sqlite3').Database): void {
    const repo = new SquadRepository(db);
    this.squadRouter = new SquadRouter(repo);
  }

  /** Build a load map for squad routing (agentId → active task count). */
  private buildLoadMap(): Map<string, number> {
    const map = new Map<string, number>();
    for (const [taskId, adapter] of this.activeTasks) {
      const agentId = adapter.agentId;
      map.set(agentId, (map.get(agentId) ?? 0) + 1);
    }
    return map;
  }

  /** Get the task poller for WS integration. */
  getPoller(): TaskQueuePoller {
    return this.poller;
  }

  // ── Internal ────────────────────────────────────────────────────

  /**
   * Execute a task that was assigned externally (WS push or squad routing).
   * This bypasses the claim step — the task is already assigned to an agent.
   */
  async executeAssignedTask(taskId: string): Promise<boolean> {
    const row = this.taskRepo.findById(taskId);
    if (!row || row.status !== 'pending') {
      // Try claiming it if still pending
      const claimed = this.taskRepo.claimSpecific(taskId, this.opts.daemonId);
      if (!claimed) return false;
      const entry = this.rowToEntry(claimed);
      this.executeTask(entry).catch((err) => {
        this.logger.error('Assigned task execution failed', { taskId: entry.id, error: String(err) });
      });
      return true;
    }
    const entry = this.rowToEntry(row);
    this.executeTask(entry).catch((err) => {
      this.logger.error('Assigned task execution failed', { taskId: entry.id, error: String(err) });
    });
    return true;
  }

  /** Claim the next pending task and execute it. Returns true if a task was claimed. */
  private async claimAndExecute(): Promise<boolean> {
    if (this.activeTasks.size >= this.opts.maxConcurrentTasks) return false;

    const row = this.findAnyClaimable();
    if (!row) return false;

    const entry = this.rowToEntry(row);
    this.executeTask(entry).catch((err) => {
      this.logger.error('Task execution failed', { taskId: entry.id, error: String(err) });
    });
    return true;
  }

  /** Scan discovered agents and claim the first pending task. */
  private findAnyClaimable() {
    const discovered = this.discoverer.getLastResults();
    for (const d of discovered) {
      if (!d.detected) continue;
      const row = this.taskRepo.claimNext(d.agentId, this.opts.daemonId);
      if (row) return row;
    }
    return null;
  }

  private async executeTask(entry: TaskQueueEntry): Promise<void> {
    const taskId = entry.id;
    const agentId = entry.agentId;

    // ── Squad routing: if this agent is a squad leader, route to a member ──
    let effectiveAgentId = agentId;
    if (this.squadRouter) {
      const inputStr = typeof entry.input === 'string' ? entry.input : JSON.stringify(entry.input);
      const routeResult = this.squadRouter.route(agentId, inputStr, this.buildLoadMap());
      if (routeResult) {
        effectiveAgentId = routeResult.targetAgentId;
        this.logger.info('Squad routed task', { squadId: agentId, to: effectiveAgentId, strategy: routeResult.strategy });
      }
    }

    const adapter = this.getAdapter(effectiveAgentId);
    if (!adapter) {
      this.taskRepo.updateStatus(taskId, 'failed', { errorMessage: `No adapter for agent: ${effectiveAgentId}` });
      this.failedCount++;
      return;
    }

    this.activeTasks.set(taskId, adapter);

    try {
      this.taskRepo.updateStatus(taskId, 'running', { startedAt: new Date().toISOString() });

      // Create isolated workspace and inject path into task
      const wsPath = this.workspaceManager.createWorkspace(effectiveAgentId, taskId);

      const result = await adapter.dispatchTask({
        task_id: taskId,
        session_id: entry.sessionId,
        capability: entry.capability,
        input: entry.input,
        slot: JSON.parse(JSON.stringify(entry.slot)), // deep-clone
        configuration: {
          max_retries: entry.maxRetries,
          timeout_ms: entry.timeoutMs,
          slot_write_url: '', // daemon handles this, not the external agent
          working_directory: wsPath, // P0-3: isolate agent to workspace
        },
      });

      if (result.status === 'completed') {
        this.taskRepo.updateStatus(taskId, 'completed', {
          output: result.output,
          completedAt: new Date().toISOString(),
        });
        this.completedCount++;
        this.wsClient?.sendCompleted(taskId, result.output, (result as any).audit?.tokens_used, (result as any).audit?.model);
        this.logger.info('Task completed', { taskId, agentId });
      } else {
        const errorMsg = result.error ?? `Task ${result.status}`;
        this.taskRepo.updateStatus(taskId, 'failed', {
          errorMessage: errorMsg,
          completedAt: new Date().toISOString(),
        });
        this.failedCount++;

        // Auto-retry on timeout
        if (result.status === 'timed_out') {
          this.taskRepo.retryTask(taskId);
        }

        this.wsClient?.sendFailed(taskId, errorMsg, result.status === 'timed_out');
        this.logger.warn('Task failed', { taskId, agentId, status: result.status, error: result.error });
      }

      // Cleanup workspace after TTL
      this.daemonRepo.updateWorkspaceLastUsed(`${agentId}_${taskId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.taskRepo.updateStatus(taskId, 'failed', { errorMessage: message });
      this.failedCount++;
      this.logger.error('Task execution error', { taskId, agentId, error: message });
    } finally {
      this.activeTasks.delete(taskId);
    }
  }

  private recoverOrphanedTasks(): void {
    try {
      const stale = this.taskRepo.findStaleClaims(this.opts.heartbeatTimeoutMs);
      if (stale.length > 0) {
        const ids = stale.map((s) => s.id);
        const reset = this.taskRepo.resetStaleClaims(ids);
        if (reset > 0) {
          this.logger.warn('Orphaned tasks recovered', { reset, total: stale.length });
        }
      }
    } catch (err) {
      this.logger.error('Orphan recovery failed', { error: String(err) });
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      try {
        this.daemonRepo.upsertHeartbeat(this.opts.daemonId, '__daemon__', 'online');
      } catch { /* non-fatal */ }
    }, this.opts.heartbeatIntervalMs);
    if (this.heartbeatTimer && typeof this.heartbeatTimer.unref === 'function') {
      this.heartbeatTimer.unref();
    }
  }

  private getAdapter(agentId: string): ExternalAgentAdapter | null {
    const cached = this.adapterCache.get(agentId);
    if (cached) return cached;

    const roleDef = this.registry.get(agentId);
    if (!roleDef?.external) return null;

    const ext = roleDef.external;
    let adapter: ExternalAgentAdapter;

    if (ext.protocol === 'cli') {
      adapter = new CliAdapter(agentId, {
        command: ext.command ?? agentId,
        args: ext.args ?? ['--print'],
        env: ext.env,
        permissionMode: ext.permissionMode as any,
        detectCommand: ext.detectCommand,
        installCommand: ext.installCommand,
        timeoutMs: ext.timeoutMs,
        maxRetries: ext.maxRetries,
      }, [], {
        info: (msg, ctx) => this.logger.info(msg, ctx),
        warn: (msg, ctx) => this.logger.warn(msg, ctx),
      });
    } else {
      adapter = new A2AConnector(agentId, {
        baseUrl: ext.baseUrl ?? `http://localhost:${agentId}`,
        healthCheckUrl: ext.healthCheckUrl,
        authConfig: ext.authConfig as any,
        timeoutMs: ext.timeoutMs,
        maxRetries: ext.maxRetries,
      }, {
        info: (msg, ctx) => this.logger.info(msg, ctx),
        warn: (msg, ctx) => this.logger.warn(msg, ctx),
      });
    }

    this.adapterCache.set(agentId, adapter);
    return adapter;
  }

  private rowToEntry(row: import('@cabinet/storage').TaskQueueRow): TaskQueueEntry {
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
}
