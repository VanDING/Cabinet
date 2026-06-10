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
import { execSync } from 'node:child_process';
import type { ContextSlot, TaskQueueEntry, TaskQueueStatus, DaemonStatus, DaemonAgentInfo } from '@cabinet/types';
import type {
  AgentTaskQueueRepository,
  AgentDaemonRepository,
} from '@cabinet/storage';
import type { AgentRoleRegistry } from '../agent-roles.js';
import { CliAdapter } from '../adapters/cli-adapter.js';
import { A2AConnector } from '../adapters/harness/a2a.js';
import { A2AHarnessRuntime } from '../adapters/harness/a2a.js';
import { HarnessRuntimeFactory } from '../adapters/harness/factory.js';
import type { ExternalAgentAdapter } from '../adapters/types.js';
import type { HarnessRuntime, HarnessContext, AgentTaskMetrics, HarnessConfig } from '../adapters/harness-runtime.js';
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
  private harnessRuntimeCache = new Map<string, HarnessRuntime>(); // agentId → HarnessRuntime
  private activeTasks = new Map<string, ExternalAgentAdapter>(); // taskId → adapter
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private orphanRecoveryTimer: ReturnType<typeof setInterval> | null = null;
  private workspaceGCTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt: number = Date.now();
  private completedCount = 0;
  private failedCount = 0;
  private wsClient: import('./ws-daemon-client.js').WSDaemonClient | null = null;
  private squadRouter: SquadRouter | null = null;
  private processMetrics = new Map<string, { pid: number; cpu: number; mem: number; ports: number[] }>();
  private lastCpuUsage = process.cpuUsage();
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
    this.discoverer = new AutoDiscoverer(registry, undefined);
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

    // Close harness runtimes
    for (const runtime of this.harnessRuntimeCache.values()) {
      try { await runtime.stop(); } catch { /* best-effort */ }
    }
    this.harnessRuntimeCache.clear();

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
    this.collectProcessMetrics();
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
    const allListening = this.scanAllListeningPorts();
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
    this.collectProcessMetrics();
    const agentPorts: Record<string, number[]> = {};
    const knownPorts: number[] = [];
    for (const [agentId, metrics] of this.processMetrics) {
      agentPorts[agentId] = metrics.ports;
      knownPorts.push(...metrics.ports);
    }
    const allListening = this.scanAllListeningPorts();
    return { agentPorts, orphans: allListening.filter((p) => !knownPorts.includes(p)) };
  }

  /** Kill a specific orphan port. */
  killOrphanPort(port: number): boolean {
    try {
      if (process.platform === 'win32') {
        const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', timeout: 5000 });
        const pidMatch = out.match(/(\d+)\s*$/m);
        if (pidMatch) execSync(`taskkill /PID ${pidMatch[1]} /F`, { timeout: 5000 });
      } else {
        execSync(`lsof -ti:${port} | xargs kill -9`, { timeout: 5000 });
      }
      return true;
    } catch { return false; }
  }

  /** Collect OS-level metrics for active agent processes. */
  private collectProcessMetrics(): void {
    const currentCpu = process.cpuUsage(this.lastCpuUsage);
    const elapsedMs = Date.now() - this.startedAt || 1;
    const elapsedSec = elapsedMs / 1000;
    // CPU % = (user+system time in μs) / (elapsed time in μs) * 100, normalized per core
    const cpuPercent = Math.round(((currentCpu.user + currentCpu.system) / 1000 / (elapsedMs * 10)) * 100) / 100;
    const memUsage = process.memoryUsage();

    // For each discovered agent, try to get per-process metrics from active tasks
    for (const [taskId, adapter] of this.activeTasks) {
      const task = this.getTask(taskId);
      if (!task) continue;
      const agentId = task.agentId;

      // Get ports for this agent's tasks
      let ports: number[] = [];
      try {
        ports = this.scanPortsForPid(process.pid); // approximate — we track the main process
      } catch { /* best-effort */ }

      this.processMetrics.set(agentId, {
        pid: process.pid,
        cpu: cpuPercent,
        mem: Math.round(memUsage.rss / 1024 / 1024),
        ports,
      });
    }

    // Also set metrics for discovered agents that have no active tasks
    const discovered = this.discoverer.getLastResults();
    for (const d of discovered) {
      if (!this.processMetrics.has(d.agentId)) {
        this.processMetrics.set(d.agentId, { pid: 0, cpu: 0, mem: 0, ports: [] });
      }
    }
  }

  /** Scan all LISTEN ports on the machine. */
  private scanAllListeningPorts(): number[] {
    try {
      const cmd = process.platform === 'win32'
        ? 'netstat -ano | findstr LISTENING'
        : "lsof -i -P -n | grep LISTEN | awk '{print $9}' | cut -d: -f2";
      const out = execSync(cmd, { encoding: 'utf8', timeout: 5000 });
      const ports = new Set<number>();
      for (const line of out.split('\n')) {
        const match = process.platform === 'win32'
          ? line.match(/:(\d+)\s/)
          : line.match(/^\d+/);
        if (match) ports.add(parseInt(match[1] || match[0], 10));
      }
      return [...ports].filter((p) => p > 0 && p < 65536);
    } catch { return []; }
  }

  /** Scan ports associated with a specific PID. */
  private scanPortsForPid(pid: number): number[] {
    try {
      const cmd = process.platform === 'win32'
        ? `netstat -ano | findstr ${pid}`
        : `lsof -i -P -n -p ${pid} | grep LISTEN | awk '{print $9}' | cut -d: -f2`;
      const out = execSync(cmd, { encoding: 'utf8', timeout: 5000 });
      const ports = new Set<number>();
      for (const line of out.split('\n')) {
        const match = process.platform === 'win32'
          ? line.match(/:(\d+)\s.*LISTENING/)
          : line.match(/^\d+/);
        if (match) ports.add(parseInt(match[1] || match[0], 10));
      }
      return [...ports];
    } catch { return []; }
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

  /** Set agent role repository for persisting discovered agents to DB. */
  setAgentRoleRepo(repo: import('@cabinet/storage').AgentRoleRepository): void {
    (this.discoverer as any).agentRoleRepo = repo;
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

    // ── Harness Runtime: get harness-aware runtime for context injection + metrics ──
    const harnessRuntime = this.getHarnessRuntime(effectiveAgentId);

    this.activeTasks.set(taskId, adapter);

    try {
      this.taskRepo.updateStatus(taskId, 'running', { startedAt: new Date().toISOString() });

      // Create isolated workspace and inject path into task
      const wsPath = this.workspaceManager.createWorkspace(effectiveAgentId, taskId);

      // Build harness context for injection
      const harnessContext = harnessRuntime
        ? this.buildHarnessContext(harnessRuntime, wsPath)
        : undefined;

      // Deep-clone slot and inject harness context
      const enrichedSlot = JSON.parse(JSON.stringify(entry.slot));
      if (harnessContext) {
        enrichedSlot.harnessContext = harnessContext;
      }

      const result = await adapter.dispatchTask({
        task_id: taskId,
        session_id: entry.sessionId,
        capability: entry.capability,
        input: entry.input,
        slot: enrichedSlot,
        configuration: {
          max_retries: entry.maxRetries,
          timeout_ms: entry.timeoutMs,
          slot_write_url: '', // daemon handles this, not the external agent
          working_directory: wsPath, // isolate agent to workspace
        },
      });

      // ── Extract harness-specific metrics ──
      if (harnessRuntime?.extractMetrics) {
        const outputStr = typeof result.output === 'string' ? result.output : (result.output ? JSON.stringify(result.output) : '');
        const errorStr = result.error ?? '';
        const harnessMetrics = harnessRuntime.extractMetrics(outputStr, errorStr);
        if (harnessMetrics.tokensUsed || harnessMetrics.model) {
          this.logger.info('Harness metrics extracted', { taskId, harnessId: harnessRuntime.harnessId, metrics: harnessMetrics });
          // Merge into process metrics
          const existing = this.processMetrics.get(effectiveAgentId) ?? { pid: 0, cpu: 0, mem: 0, ports: [] };
          this.processMetrics.set(effectiveAgentId, {
            ...existing,
            cpu: harnessMetrics.tokensUsed ?? existing.cpu, // Note: we repurpose cpu field temporarily for tokens
            mem: harnessMetrics.contextWindowPercent ?? existing.mem,
          });
        }
      }

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

  /**
   * Get or create a HarnessRuntime for the given agent.
   *
   * Unlike getAdapter() which returns a generic ExternalAgentAdapter,
   * this returns a HarnessRuntime that supports harness-specific:
   *   - Prompt format conversion (convertPrompt)
   *   - Output parsing (parseOutput)
   *   - Metrics extraction (extractMetrics)
   *   - Skill injection (injectSkill)
   *   - Session discovery (discoverSessions)
   *
   * CLI agents get their harness auto-detected from the command name.
   * A2A agents get the A2AHarnessRuntime with WebSocket support.
   */
  private getHarnessRuntime(agentId: string): HarnessRuntime | null {
    const cached = this.harnessRuntimeCache.get(agentId);
    if (cached) return cached;

    const roleDef = this.registry.get(agentId);
    if (!roleDef?.external) return null;

    const ext = roleDef.external;
    let runtime: HarnessRuntime;

    if (ext.protocol === 'cli') {
      // Build HarnessConfig and let factory auto-detect the harness from command name
      const harnessConfig: HarnessConfig = {
        harnessId: 'generic', // triggers auto-detection in factory
        command: ext.command ?? agentId,
        args: ext.args ?? ['--print'],
        env: ext.env,
        permissionMode: ext.permissionMode as any,
        timeoutMs: ext.timeoutMs,
        maxRetries: ext.maxRetries,
      };

      runtime = HarnessRuntimeFactory.create(agentId, harnessConfig, [], {
        info: (msg, ctx) => this.logger.info(msg, ctx),
        warn: (msg, ctx) => this.logger.warn(msg, ctx),
      });
    } else {
      // A2A: use first-class A2AHarnessRuntime (with WebSocket support)
      const harnessConfig: HarnessConfig = {
        harnessId: 'a2a',
        baseUrl: ext.baseUrl ?? `http://localhost:${agentId}`,
        healthCheckUrl: ext.healthCheckUrl,
        authConfig: ext.authConfig as any,
        timeoutMs: ext.timeoutMs,
        maxRetries: ext.maxRetries,
      };

      runtime = new A2AHarnessRuntime(agentId, harnessConfig, {
        info: (msg, ctx) => this.logger.info(msg, ctx),
        warn: (msg, ctx) => this.logger.warn(msg, ctx),
      });
    }

    this.harnessRuntimeCache.set(agentId, runtime);
    this.logger.info('HarnessRuntime created', { agentId, harnessId: runtime.harnessId });
    return runtime;
  }

  /**
   * Build harness context for injection into a task slot.
   * This tells the harness about the execution environment.
   */
  private buildHarnessContext(runtime: HarnessRuntime, workspacePath?: string): HarnessContext {
    return {
      harnessId: runtime.harnessId,
      protocol: runtime.protocol,
      outputFormat: runtime.harnessId === 'claude-code'
        ? 'Anthropic tool-use JSON'
        : runtime.harnessId === 'codex'
          ? 'OpenAI function-calling JSON'
          : runtime.harnessId === 'opencode'
            ? 'Markdown with SQLite session'
            : runtime.harnessId === 'a2a'
              ? 'A2A structured JSON over WebSocket/HTTP'
              : 'Cabinet internal format (===CABINET_DELIVERABLE===)',
      permissionProfile: (runtime as any).config?.permissionMode ?? 'auto',
      workspacePath,
    };
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
