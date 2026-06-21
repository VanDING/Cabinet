import { CliAdapter, A2AConnector } from '@cabinet/agent';
import type { ContextSlot } from '@cabinet/types';
import { getServerContext } from '../../../../context.js';
import { broadcast } from '../../../../ws/handler.js';

export async function dispatchToExternalAgent(
  agentId: string,
  message: string,
  sessionId: string,
  projectId: string,
  captainId: string,
): Promise<string> {
  const ctx = getServerContext();
  const registry = ctx.agentRegistry;
  const roleDef = registry.get(agentId);
  if (!roleDef?.external) return `[Error] Agent ${agentId} has no external config.`;

  // ── Create child session ──
  const childSessionId = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  ctx.sessionManager.create(childSessionId, `External: ${agentId}`, projectId);
  const childSession = ctx.sessionManager.get(childSessionId);
  if (childSession) {
    childSession.parentId = sessionId;
    childSession.agentType = agentId;
    childSession.status = 'active';
  }

  // ── Initialize Context Slot ──
  const slot = await buildContextSlot(projectId, captainId, message, sessionId, agentId);
  ctx.sessionManager.setContextSlot(childSessionId, slot);

  // ── Pull-mode (daemon): enqueue task for async execution ──
  if (ctx.daemon?.hasAgent(agentId)) {
    const taskId = await ctx.daemon.enqueueTask({
      agentId,
      sessionId: childSessionId,
      capability: 'default',
      input: message,
      slot,
      maxRetries: roleDef.external.maxRetries ?? 2,
      timeoutMs: roleDef.external.timeoutMs ?? 120_000,
    });

    ctx.sessionManager.associateTask(taskId, childSessionId);

    if (childSession) {
      childSession.status = 'active';
      // Store task reference so EventBus can correlate result later
      (childSession as { _daemonTaskId?: string })._daemonTaskId = taskId;
    }

    ctx.logger.info('External agent task enqueued (pull-mode)', {
      agentId,
      taskId,
      sessionId: childSessionId,
    });

    return `[Queued] Task ${taskId} dispatched to ${agentId}.\nTrack progress: /api/daemon/tasks/${taskId}`;
  }

  // ── Push-mode (fallback): direct adapter dispatch ──
  // In push-mode task_id = childSessionId, so getSessionByTaskId would find it
  // via sessionManager.get(taskId) fallback, but register for consistency
  ctx.sessionManager.associateTask(childSessionId, childSessionId);

  // ── Build external task ──
  const task = {
    task_id: childSessionId,
    session_id: childSessionId,
    capability: 'default',
    input: message,
    slot,
    configuration: {
      max_retries: roleDef.external.maxRetries ?? 2,
      timeout_ms: roleDef.external.timeoutMs ?? 120_000,
      slot_write_url: `http://localhost:${process.env.PORT ?? 3000}/api/slot/${childSessionId}/write`,
    },
  };

  // ── Dispatch via adapter ──
  try {
    const adapter = getOrCreateAdapter(agentId, roleDef);
    const result = await adapter.dispatchTask(task);

    // Inject result into child session
    if (childSession) {
      childSession.deliverable = result.output;
      childSession.status = result.status === 'completed' ? 'completed' : 'error';
    }

    // Inject deliverable into parent session via AgentEventBus
    ctx.agentEventBus.publish(childSessionId, sessionId, {
      type: 'completed',
      deliverable: { agentId, output: result.output, discoveries: result.discoveries },
      timestamp: Date.now(),
    });

    ctx.logger.info('External agent task completed (push-mode)', {
      agentId,
      taskId: childSessionId,
      status: result.status,
    });

    return typeof result.output === 'string' ? result.output : JSON.stringify(result.output ?? {});
  } catch (err) {
    ctx.logger.error('External agent task failed (push-mode)', { agentId, error: String(err) });
    if (childSession) childSession.status = 'error';
    return `[External Agent Error] ${agentId}: ${String(err)}`;
  }
}

/** Build a Context Slot with project context, memories, and preferences. */
export async function buildContextSlot(
  projectId: string,
  captainId: string,
  taskDescription: string,
  sessionId: string,
  agentType?: string,
): Promise<ContextSlot> {
  const ctx = getServerContext();
  const projectCtx = ctx.project.get(projectId);
  const prefs = ctx.entity.getPreferences(captainId);
  const recentFiles = ctx.fileTracker.getRecent(sessionId, 5);

  // Fall back to project repo if memory isn't populated yet
  let projectName = projectCtx?.summary;
  let projectGoals = projectCtx?.goals ?? [];
  let projectTech = (projectCtx as any)?.techSummary;
  if (!projectCtx) {
    const dbProject = ctx.projectRepo.findById(projectId);
    if (dbProject) {
      projectName = dbProject.name;
      projectGoals = [];
      projectTech = undefined;
    }
  }

  // Search long-term memory for relevant context
  let memories: string[] = [];
  try {
    const results = await ctx.longTerm.search(taskDescription, 5);
    memories = results.map((r: any) => r.content);
  } catch {
    /* memory search is best-effort */
  }

  // Inject skills bound to this agent
  let boundSkills: string[] = [];
  if (agentType && (ctx as any).agentBindingRepo) {
    try {
      boundSkills = (ctx as any).agentBindingRepo.getEnabledSkillsForAgent(agentType);
    } catch {
      /* best-effort */
    }
  }

  // Inject MCP servers bound to this agent
  let boundMcpServers: string[] = [];
  if (agentType && (ctx as any).agentBindingRepo) {
    try {
      boundMcpServers = (ctx as any).agentBindingRepo.getEnabledMcpServersForAgent(agentType);
    } catch {
      /* best-effort */
    }
  }

  return {
    version: 0,
    project: {
      name: projectName ?? projectId,
      tech_stack: projectTech,
      goals: projectGoals,
    },
    memories,
    preferences: (prefs?.preferences ?? {}) as Record<string, unknown>,
    files: recentFiles.map((f: any) => f.path),
    discoveries: [],
    previous_outputs: [],
    security: {
      level: 'L1',
      maxRetries: 2,
    },
    skills: boundSkills.length > 0 ? boundSkills : undefined,
    mcpServers: boundMcpServers.length > 0 ? boundMcpServers : undefined,
  };
}

/** Cache of created adapters, keyed by agentId. */
export const adapterCache = new Map<string, any>();

/** Get or create an adapter for an external agent. */
export function getOrCreateAdapter(
  agentId: string,
  roleDef: import('@cabinet/agent').AgentRole,
): any {
  const cached = adapterCache.get(agentId);
  if (cached) return cached;

  const ext = roleDef.external!;
  if (ext.protocol === 'cli') {
    const adapter = new CliAdapter(agentId, {
      command: ext.command ?? agentId,
      args: ext.args ?? ['--print'],
      env: ext.env,
      permissionMode: ext.permissionMode as 'auto' | 'conservative',
      detectCommand: ext.detectCommand,
      installCommand: ext.installCommand,
      timeoutMs: ext.timeoutMs,
      maxRetries: ext.maxRetries,
    });
    adapterCache.set(agentId, adapter);
    return adapter;
  }

  // A2A
  const adapter = new A2AConnector(agentId, {
    baseUrl: ext.baseUrl ?? `http://localhost:${agentId}`,
    healthCheckUrl: ext.healthCheckUrl,
    authConfig: ext.authConfig as { type: 'api_key' | 'oauth'; header?: string; envVar?: string },
    timeoutMs: ext.timeoutMs,
    maxRetries: ext.maxRetries,
  });
  adapterCache.set(agentId, adapter);
  return adapter;
}
