import type { TaskQueueEntry } from '@cabinet/types';
import type { AgentDaemonState } from './internal.js';
import { getAdapter, getHarnessRuntime, buildHarnessContext } from './adapters.js';
import { buildLoadMap } from './discovery.js';

/**
 * Execute a task that was assigned externally (WS push or squad routing).
 * This bypasses the claim step — the task is already assigned to an agent.
 */
export async function executeAssignedTask(
  daemon: AgentDaemonState,
  taskId: string,
): Promise<boolean> {
  const row = daemon.taskRepo.findById(taskId);
  if (!row || row.status !== 'pending') {
    // Try claiming it if still pending
    const claimed = daemon.taskRepo.claimSpecific(taskId, daemon.opts.daemonId);
    if (!claimed) return false;
    const entry = daemon.rowToEntry(claimed);
    executeTask(daemon, entry).catch((err) => {
      daemon.logger.error('Assigned task execution failed', {
        taskId: entry.id,
        error: String(err),
      });
    });
    return true;
  }
  const entry = daemon.rowToEntry(row);
  executeTask(daemon, entry).catch((err) => {
    daemon.logger.error('Assigned task execution failed', { taskId: entry.id, error: String(err) });
  });
  return true;
}

/** Claim the next pending task and execute it. Returns true if a task was claimed. */
export async function claimAndExecute(daemon: AgentDaemonState): Promise<boolean> {
  if (daemon.activeTasks.size >= daemon.opts.maxConcurrentTasks) return false;

  const row = findAnyClaimable(daemon);
  if (!row) return false;

  const entry = daemon.rowToEntry(row);
  executeTask(daemon, entry).catch((err) => {
    daemon.logger.error('Task execution failed', { taskId: entry.id, error: String(err) });
  });
  return true;
}

/** Scan discovered agents and claim the first pending task. */
function findAnyClaimable(daemon: AgentDaemonState) {
  const discovered = daemon.discoverer.getLastResults();
  for (const d of discovered) {
    if (!d.detected) continue;
    const row = daemon.taskRepo.claimNext(d.agentId, daemon.opts.daemonId);
    if (row) return row;
  }
  return null;
}

export async function executeTask(daemon: AgentDaemonState, entry: TaskQueueEntry): Promise<void> {
  const taskId = entry.id;
  const agentId = entry.agentId;

  // ── Squad routing: if this agent is a squad leader, route to a member ──
  let effectiveAgentId = agentId;
  if (daemon.squadRouter) {
    const inputStr = typeof entry.input === 'string' ? entry.input : JSON.stringify(entry.input);
    const routeResult = daemon.squadRouter.route(agentId, inputStr, buildLoadMap(daemon));
    if (routeResult) {
      effectiveAgentId = routeResult.targetAgentId;
      daemon.logger.info('Squad routed task', {
        squadId: agentId,
        to: effectiveAgentId,
        strategy: routeResult.strategy,
      });
    }
  }

  const adapter = getAdapter(daemon, effectiveAgentId);
  if (!adapter) {
    daemon.taskRepo.updateStatus(taskId, 'failed', {
      errorMessage: `No adapter for agent: ${effectiveAgentId}`,
    });
    daemon.failedCount++;
    return;
  }

  // ── Harness Runtime: get harness-aware runtime for context injection + metrics ──
  const harnessRuntime = getHarnessRuntime(daemon, effectiveAgentId);

  daemon.activeTasks.set(taskId, adapter);

  try {
    daemon.taskRepo.updateStatus(taskId, 'running', { startedAt: new Date().toISOString() });

    // Create isolated workspace and inject path into task
    const wsPath = daemon.workspaceManager.createWorkspace(effectiveAgentId, taskId);

    // Build harness context for injection
    const harnessContext = harnessRuntime ? buildHarnessContext(harnessRuntime, wsPath) : undefined;

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
      const outputStr =
        typeof result.output === 'string'
          ? result.output
          : result.output
            ? JSON.stringify(result.output)
            : '';
      const errorStr = result.error ?? '';
      const harnessMetrics = harnessRuntime.extractMetrics(outputStr, errorStr);
      if (harnessMetrics.tokensUsed || harnessMetrics.model) {
        daemon.logger.info('Harness metrics extracted', {
          taskId,
          harnessId: harnessRuntime.harnessId,
          metrics: harnessMetrics,
        });
        // Merge into process metrics
        const existing = daemon.processMetrics.get(effectiveAgentId) ?? {
          pid: 0,
          cpu: 0,
          mem: 0,
          ports: [],
        };
        daemon.processMetrics.set(effectiveAgentId, {
          ...existing,
          cpu: harnessMetrics.tokensUsed ?? existing.cpu, // Note: we repurpose cpu field temporarily for tokens
          mem: harnessMetrics.contextWindowPercent ?? existing.mem,
        });
      }
    }

    if (result.status === 'completed') {
      daemon.taskRepo.updateStatus(taskId, 'completed', {
        output: result.output,
        completedAt: new Date().toISOString(),
      });
      daemon.completedCount++;
      daemon.wsClient?.sendCompleted(
        taskId,
        result.output,
        (result as any).audit?.tokens_used,
        (result as any).audit?.model,
      );
      daemon.logger.info('Task completed', { taskId, agentId });
    } else {
      const errorMsg = result.error ?? `Task ${result.status}`;
      daemon.taskRepo.updateStatus(taskId, 'failed', {
        errorMessage: errorMsg,
        completedAt: new Date().toISOString(),
      });
      daemon.failedCount++;

      // Auto-retry on timeout
      if (result.status === 'timed_out') {
        daemon.taskRepo.retryTask(taskId);
      }

      daemon.wsClient?.sendFailed(taskId, errorMsg, result.status === 'timed_out');
      daemon.logger.warn('Task failed', {
        taskId,
        agentId,
        status: result.status,
        error: result.error,
      });
    }

    // Cleanup workspace after TTL
    daemon.daemonRepo.updateWorkspaceLastUsed(`${agentId}_${taskId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    daemon.taskRepo.updateStatus(taskId, 'failed', { errorMessage: message });
    daemon.failedCount++;
    daemon.logger.error('Task execution error', { taskId, agentId, error: message });
  } finally {
    daemon.activeTasks.delete(taskId);
  }
}

export function recoverOrphanedTasks(daemon: AgentDaemonState): void {
  try {
    const stale = daemon.taskRepo.findStaleClaims(daemon.opts.heartbeatTimeoutMs);
    if (stale.length > 0) {
      const ids = stale.map((s) => s.id);
      const reset = daemon.taskRepo.resetStaleClaims(ids);
      if (reset > 0) {
        daemon.logger.warn('Orphaned tasks recovered', { reset, total: stale.length });
      }
    }
  } catch (err) {
    daemon.logger.error('Orphan recovery failed', { error: String(err) });
  }
}

export function startHeartbeat(daemon: AgentDaemonState): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    try {
      daemon.daemonRepo.upsertHeartbeat(daemon.opts.daemonId, '__daemon__', 'online');
    } catch {
      /* non-fatal */
    }
  }, daemon.opts.heartbeatIntervalMs);
  if (timer && typeof timer.unref === 'function') {
    timer.unref();
  }
  return timer;
}
