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

import type {
  ContextSlot,
  TaskQueueEntry,
  TaskQueueStatus,
  DaemonStatus,
  DaemonAgentInfo,
} from '@cabinet/types';
import type { AgentTaskQueueRepository, AgentDaemonRepository } from '@cabinet/storage';
import type { AgentRoleRegistry } from '../../agent-roles.js';
import type { ExternalAgentAdapter } from '../../adapters/types.js';
import type { HarnessRuntime, HarnessContext } from '../../adapters/harness-runtime.js';
import { TaskQueuePoller } from '../task-queue-poller.js';
import { WorkspaceManager } from '../workspace-manager.js';
import { AutoDiscoverer, type DiscoveryResult } from '../auto-discoverer.js';
import { SquadRepository } from '@cabinet/storage';
import { SquadRouter } from '../squad/squad-router.js';
import type { AgentDaemonOptions } from './config.js';
import { DEFAULTS } from './config.js';
import type { AgentDaemonState } from './internal.js';
import { rowToEntry } from './conversion.js';
import {
  collectProcessMetrics,
  scanAllListeningPorts,
  killOrphanPort as killOrphanPortImpl,
} from './metrics.js';
import { getAdapter, getHarnessRuntime, buildHarnessContext } from './adapters.js';
import {
  getDiscoveredAgents,
  triggerDiscovery,
  runWorkspaceGC,
  buildLoadMap,
} from './discovery.js';
import {
  executeAssignedTask,
  claimAndExecute,
  recoverOrphanedTasks,
  startHeartbeat,
} from './execution.js';

export class AgentDaemon {
  private opts: Required<AgentDaemonOptions>;
  private poller: TaskQueuePoller;
  private workspaceManager: WorkspaceManager;
  private discoverer: AutoDiscoverer;
  private adapterCache = new Map<string, ExternalAgentAdapter>();
  private harnessRuntimeCache = new Map<string, HarnessRuntime>(); // agentId → HarnessRuntime
  private activeTasks = new Map<string, ExternalAgentAdapter>(); // taskId → adapter
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private orphanRecoveryTimer: ReturnType<typeof setInterval> | null = null;
  private workspaceGCTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt: number = Date.now();
  private completedCount = 0;
  private failedCount = 0;
  private wsClient: import('../ws-daemon-client.js').WSDaemonClient | null = null;
  private squadRouter: SquadRouter | null = null;
  private processMetrics = new Map<
    string,
    { pid: number; cpu: number; mem: number; ports: number[] }
  >();
  private lastCpuUsage = process.cpuUsage();
  private logger: {
    info: (msg: string, ctx?: unknown) => void;
    warn: (msg: string, ctx?: unknown) => void;
    error: (msg: string, ctx?: unknown) => void;
  };

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
    this.discoverer = new AutoDiscoverer(registry, undefined);
    this.poller = new TaskQueuePoller(() => claimAndExecute(this.state), {
      pollIntervalMs: this.opts.pollIntervalMs,
    });
  }

  private get state(): AgentDaemonState {
    return this as unknown as AgentDaemonState;
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  async start(): Promise<DiscoveryResult[]> {
    this.startedAt = Date.now();

    // Auto-discover agents
    let discovered: DiscoveryResult[] = [];
    if (this.opts.autoDiscoverOnStart) {
      discovered = await triggerDiscovery(this.state);
      this.logger.info('Agent discovery complete', { count: discovered.length });
    }

    // Start periodic tasks
    this.heartbeatTimer = startHeartbeat(this.state);
    this.poller.start();
    this.orphanRecoveryTimer = setInterval(() => recoverOrphanedTasks(this.state), 60_000);
    this.workspaceGCTimer = setInterval(() => runWorkspaceGC(this.state), 1_800_000);
    // Unref timers so they don't block process exit
    this.orphanRecoveryTimer?.unref?.();
    this.workspaceGCTimer?.unref?.();

    this.logger.info('AgentDaemon started', { daemonId: this.opts.daemonId });
    return discovered;
  }

  async stop(): Promise<void> {
    // Cancel all active tasks
    for (const [taskId, adapter] of this.activeTasks) {
      try {
        await adapter.cancelTask?.(taskId);
      } catch {
        /* best-effort */
      }
    }
    this.activeTasks.clear();

    // Stop timers
    this.poller.stop();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.orphanRecoveryTimer) {
      clearInterval(this.orphanRecoveryTimer);
      this.orphanRecoveryTimer = null;
    }
    if (this.workspaceGCTimer) {
      clearInterval(this.workspaceGCTimer);
      this.workspaceGCTimer = null;
    }

    // Final heartbeat + mark offline
    try {
      this.daemonRepo.upsertHeartbeat(this.opts.daemonId, '__daemon__', 'offline');
    } catch {
      /* DB may already be closed */
    }

    // Close harness runtimes
    for (const runtime of this.harnessRuntimeCache.values()) {
      try {
        await runtime.stop();
      } catch {
        /* best-effort */
      }
    }
    this.harnessRuntimeCache.clear();

    // Close adapters
    for (const adapter of this.adapterCache.values()) {
      try {
        await adapter.stop();
      } catch {
        /* best-effort */
      }
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
    return getAdapter(this.state, agentId) !== null;
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
    return rowToEntry(row);
  }

  /** Get task by ID. */
  getTask(taskId: string): TaskQueueEntry | null {
    const row = this.taskRepo.findById(taskId);
    return row ? rowToEntry(row) : null;
  }

  /** List tasks with optional filters. */
  listTasks(filter?: { status?: string; agentId?: string; limit?: number }): TaskQueueEntry[] {
    if (filter?.agentId && filter?.status) {
      return this.taskRepo
        .findByAgent(filter.agentId, filter.status, filter.limit)
        .map((r) => rowToEntry(r));
    }
    if (filter?.status) {
      return this.taskRepo.findByStatus(filter.status, filter.limit).map((r) => rowToEntry(r));
    }
    if (filter?.agentId) {
      return this.taskRepo
        .findByAgent(filter.agentId, undefined, filter.limit)
        .map((r) => rowToEntry(r));
    }
    return this.taskRepo
      .findByStatus(['pending', 'claimed', 'running'], filter?.limit ?? 50)
      .map((r) => rowToEntry(r));
  }

  /** Get daemon status. */
  getStatus(): DaemonStatus {
    collectProcessMetrics(this.state);
    const agents: DaemonAgentInfo[] = [];
    const discovered = this.discoverer.getLastResults();
    const knownPorts: number[] = [];
    for (const d of discovered) {
      const counts = this.taskRepo.countByStatus(d.agentId);
      const metrics = this.processMetrics.get(d.agentId);
      const agentInfo: DaemonAgentInfo = {
        agentId: d.agentId,
        command: d.command ?? d.baseUrl ?? 'unknown',
        detected: d.detected,
        status: 'online',
        activeTaskCount: (counts.running ?? 0) + (counts.claimed ?? 0),
        lastHeartbeatAt: null,
        cpuPercent: metrics?.cpu,
        memoryMb: metrics?.mem,
        openPorts: metrics?.ports,
        pid: metrics?.pid,
      };
      if (metrics?.ports) knownPorts.push(...metrics.ports);
      agents.push(agentInfo);
    }

    // Detect orphan ports (LISTEN ports not associated with known agents)
    const allListening = scanAllListeningPorts();
    const orphanPorts = allListening.filter((p) => !knownPorts.includes(p));

    return {
      daemonId: this.opts.daemonId,
      status: 'online',
      uptimeMs: Date.now() - this.startedAt,
      activeTaskCount: this.activeTasks.size,
      completedTaskCount: this.completedCount,
      failedTaskCount: this.failedCount,
      agents,
      orphanPorts,
    };
  }

  /** Get ports info including orphans. */
  getPorts(): { agentPorts: Record<string, number[]>; orphans: number[] } {
    collectProcessMetrics(this.state);
    const agentPorts: Record<string, number[]> = {};
    const knownPorts: number[] = [];
    for (const [agentId, metrics] of this.processMetrics) {
      agentPorts[agentId] = metrics.ports;
      knownPorts.push(...metrics.ports);
    }
    const allListening = scanAllListeningPorts();
    return { agentPorts, orphans: allListening.filter((p) => !knownPorts.includes(p)) };
  }

  /** Kill a specific orphan port. */
  killOrphanPort(port: number): boolean {
    return killOrphanPortImpl(port);
  }

  /** Get discovered agents. */
  getDiscoveredAgents(): DiscoveryResult[] {
    return getDiscoveredAgents(this.state);
  }

  /** Trigger rediscovery. */
  triggerDiscovery(): Promise<DiscoveryResult[]> {
    return triggerDiscovery(this.state);
  }

  /** Trigger workspace GC. */
  runWorkspaceGC(): ReturnType<WorkspaceManager['runGC']> {
    return runWorkspaceGC(this.state);
  }

  /** Set WS client for real-time progress reporting. */
  setWSClient(client: import('../ws-daemon-client.js').WSDaemonClient): void {
    this.wsClient = client;
  }

  /** Set squad router for team-based task routing. */
  setSquadRouter(db: import('better-sqlite3').Database): void {
    const repo = new SquadRepository(db);
    this.squadRouter = new SquadRouter(repo);
  }

  /** Set agent role repository for persisting discovered agents to DB. */
  setAgentRoleRepo(repo: import('@cabinet/storage').AgentRoleRepository): void {
    (this.discoverer as any).agentRoleRepo = repo;
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
    return executeAssignedTask(this.state, taskId);
  }

  /** Get or create an adapter for the given agent. */
  private getAdapter(agentId: string): ExternalAgentAdapter | null {
    return getAdapter(this.state, agentId);
  }

  /** Get or create a HarnessRuntime for the given agent. */
  private getHarnessRuntime(agentId: string): HarnessRuntime | null {
    return getHarnessRuntime(this.state, agentId);
  }

  /** Build harness context for injection into a task slot. */
  private buildHarnessContext(runtime: HarnessRuntime, workspacePath?: string): HarnessContext {
    return buildHarnessContext(runtime, workspacePath);
  }

  /** Convert a DB row to a TaskQueueEntry. */
  private rowToEntry(row: import('@cabinet/storage').TaskQueueRow): TaskQueueEntry {
    return rowToEntry(row);
  }
}
