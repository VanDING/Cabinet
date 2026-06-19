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

import type { ContextSlot, TaskQueueEntry, DaemonStatus } from '@cabinet/types';
import type { AgentTaskQueueRepository, AgentDaemonRepository } from '@cabinet/storage';
import type { AgentRoleRegistry } from '../../agent-roles.js';
import type { ExternalAgentAdapter } from '../../adapters/types.js';
import type { HarnessRuntime } from '../../adapters/harness-runtime.js';
import { TaskQueuePoller } from '../task-queue-poller.js';
import { WorkspaceManager } from '../workspace-manager.js';
import { AutoDiscoverer, type DiscoveryResult } from '../auto-discoverer.js';
import { SquadRepository } from '@cabinet/storage';
import { SquadRouter } from '../squad/squad-router.js';
import type { AgentDaemonOptions } from './config.js';
import { DEFAULTS } from './config.js';
import type { AgentDaemonState } from './internal.js';
import { getAdapter } from './adapters.js';
import {
  getDaemonStatus,
  getPortsInfo,
  killOrphanPort,
  getDiscoveredAgents,
  triggerDiscovery,
  runWorkspaceGC,
} from './status.js';
import { enqueueTask, cancelTask, retryTask, getTask, listTasks } from './tasks.js';
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

  private createState(): AgentDaemonState {
    return {
      taskRepo: this.taskRepo,
      daemonRepo: this.daemonRepo,
      registry: this.registry,
      opts: this.opts,
      workspaceManager: this.workspaceManager,
      discoverer: this.discoverer,
      adapterCache: this.adapterCache,
      harnessRuntimeCache: this.harnessRuntimeCache,
      activeTasks: this.activeTasks,
      startedAt: this.startedAt,
      completedCount: this.completedCount,
      failedCount: this.failedCount,
      wsClient: this.wsClient,
      squadRouter: this.squadRouter,
      processMetrics: this.processMetrics,
      lastCpuUsage: this.lastCpuUsage,
      logger: this.logger,
    };
  }

  private get state(): AgentDaemonState {
    return this.createState();
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
    return enqueueTask(this.state, params);
  }

  /** Check if the daemon has an adapter for the given agent. */
  hasAgent(agentId: string): boolean {
    return getAdapter(this.state, agentId) !== null;
  }

  /** Cancel a pending or claimed task. */
  cancelTask(taskId: string): boolean {
    return cancelTask(this.state, taskId);
  }

  /** Retry a failed task. */
  retryTask(taskId: string): TaskQueueEntry | null {
    return retryTask(this.state, taskId);
  }

  /** Get task by ID. */
  getTask(taskId: string): TaskQueueEntry | null {
    return getTask(this.state, taskId);
  }

  /** List tasks with optional filters. */
  listTasks(filter?: { status?: string; agentId?: string; limit?: number }): TaskQueueEntry[] {
    return listTasks(this.state, filter);
  }

  /** Get daemon status. */
  getStatus(): DaemonStatus {
    return getDaemonStatus(this.state);
  }

  /** Get ports info including orphans. */
  getPorts(): { agentPorts: Record<string, number[]>; orphans: number[] } {
    return getPortsInfo(this.state);
  }

  /** Kill a specific orphan port. */
  killOrphanPort(port: number): boolean {
    return killOrphanPort(port);
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

  /**
   * Execute a task that was assigned externally (WS push or squad routing).
   * This bypasses the claim step — the task is already assigned to an agent.
   */
  async executeAssignedTask(taskId: string): Promise<boolean> {
    return executeAssignedTask(this.state, taskId);
  }
}
