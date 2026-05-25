import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import { broadcast } from '../ws/handler.js';
import { WorkflowEngine, type WorkflowNodeDef, type WorkflowEdge, type WorkflowRun, type AgentLoopHandle } from '@cabinet/workflow';
import { DEFAULT_CAPTAIN_ID } from '@cabinet/types';
import {
  AgentLoop,
  ToolExecutor,
  SafetyChecker,
  CheckpointManager,
  registerCabinetTools,
  registerSkillTools,
  registerMCPTools,
} from '@cabinet/agent';
import type { ToolDependencies } from '@cabinet/agent';
import type { WorkflowCapabilities } from '@cabinet/types';
import { createAllCapabilities, buildEnvironmentSection, type CapabilitiesContext } from '../capabilities.js';

// ── Shared engine instance ──
let engine: WorkflowEngine | null = null;

// ── ToolExecutor cache (keyed by capability JSON hash) ──
const toolExecutorCache = new Map<string, ToolExecutor>();

// ── AgentLoop instance pool (keyed by runId:agentId, LRU eviction, max 10) ──
const AGENT_LOOP_POOL_MAX = 10;
const agentLoopPool = new Map<string, AgentLoop>();

// ── Capabilities cache (workflowId → capabilities declared in definition) ──
const capabilityCache = new Map<string, WorkflowCapabilities>();
// Pending capabilities for the currently-starting workflow (set before startRun, read in createAgentLoop)
let pendingCapabilities: WorkflowCapabilities = {};

/** Helper: return a stub that throws with a capabilities-gated message, matching the expected return type. */
function stub<T>(feature: string): T {
  const msg = `${feature} not enabled. Add "capabilities" to workflow definition.`;
  return (async () => { throw new Error(msg); }) as unknown as T;
}

// ── Tool dependencies (capabilities-gated for workflow agents) ──
function buildToolDependencies(caps: WorkflowCapabilities = {}): ToolDependencies {
  const ctx = getServerContext();
  const capabilitiesCtx: CapabilitiesContext = {
    db: ctx.db,
    gateway: ctx.gateway,
    logger: ctx.logger,
    taskScheduler: ctx.taskScheduler,
  };
  const shared = createAllCapabilities(capabilitiesCtx);

  return {
    decisionStore: ctx.decisionRepo,
    eventBus: ctx.eventBus,
    shortTerm: ctx.shortTerm,
    longTerm: ctx.longTerm,
    entity: ctx.entity,
    project: ctx.project,
    createDecision(input) {
      const id = `dec_${Date.now()}`;
      return ctx.decisionService.create({
        id,
        projectId: input.projectId,
        type: input.type,
        title: input.title,
        description: input.description,
        options: input.options,
        classification: input.classification,
        captainId: input.captainId,
      }) as any;
    },
    approveDecision(decisionId, captainId, chosenOptionId) {
      return ctx.decisionService.approve(decisionId, captainId, chosenOptionId);
    },
    rejectDecision(decisionId, captainId) {
      return ctx.decisionService.reject(decisionId, captainId);
    },
    listWorkflows() {
      const rows = ctx.workflowRepo.listByProject('default');
      return rows.map((r) => {
        const def = JSON.parse(r.definition ?? '{}');
        return {
          id: r.id,
          name: r.name,
          status: r.status,
          stepCount: def.steps ? def.steps.length : (def.nodes ?? []).length,
        };
      });
    },
    getWorkflow(id) {
      const row = ctx.workflowRepo.findById(id);
      if (!row) return undefined;
      return { id: row.id, name: row.name, definition: JSON.parse(row.definition ?? '{}'), status: row.status };
    },
    createWorkflow(input) {
      const id = `wf_${Date.now()}`;
      ctx.workflowRepo.create(id, input.projectId ?? 'default', input.name, JSON.stringify(input.definition ?? {}), 'draft');
      return { id };
    },
    updateWorkflow(id, input) {
      if (input.name !== undefined || input.definition !== undefined) {
        ctx.workflowRepo.updateNameAndDefinition(
          id,
          input.name,
          input.definition !== undefined ? JSON.stringify(input.definition) : undefined,
        );
      }
    },
    deleteWorkflow(id) {
      ctx.workflowRepo.delete(id);
    },
    async runWorkflow(_id) {
      return { runId: '', status: 'not_implemented' };
    },
    async startMeeting(topic, _advisorIds) {
      const meetingId = `meeting_${Date.now()}`;
      return { meetingId, topic, synthesis: '', perspectives: [] };
    },
    async writeLongTermMemory(content, metadata) {
      return ctx.longTerm.store({ content, metadata: metadata ?? {}, timestamp: new Date() });
    },
    createEmployee(_input) {},
    registerAgent(input) {
      ctx.agentRegistry.register({
        type: 'custom' as const,
        name: input.name,
        description: input.description,
        systemPrompt: input.systemPrompt,
        modelTier: ((input as any).modelTier as string || 'default') as any,
        model: input.model,
        temperature: input.temperature,
        maxResponseTokens: input.maxResponseTokens,
        allowedTools: input.allowedTools,
        contextBudget: input.contextBudget,
      });
      return { type: 'custom', name: input.name };
    },
    updateAgent(name, updates) {
      const existing = ctx.agentRegistry.get(name);
      if (existing && existing.type === 'custom') {
        ctx.agentRegistry.update(name, updates as any);
      }
    },
    deleteAgent(name) {
      ctx.agentRegistry.unregister(name);
      ctx.agentRoleRepo.deleteByName(name);
    },
    listAgents() {
      return ctx.agentRegistry.list().map((r) => ({
        type: r.type, name: r.name, description: r.description, builtIn: r.type !== 'custom',
      }));
    },
    async invokeAgent(_agentName, _message) {
      throw new Error('Agent invocation not available in workflow tool context');
    },
    setProjectContext(projectId) {
      const row = ctx.projectRepo.findById(projectId);
      if (!row) throw new Error(`Project not found: ${projectId}`);
      return { id: row.id, name: row.name };
    },
    createProject(input) {
      const id = `proj_${Date.now()}`;
      ctx.projectRepo.create({
        id,
        name: input.name,
        description: input.description ?? '',
        status: 'active',
        rootPath: input.rootPath ?? '',
        createdAt: new Date(),
      });
      return { id, name: input.name };
    },
    listProjects() {
      const rows = ctx.projectRepo.listAll().filter((p) => !p.archived);
      return rows.map((r) => ({ id: r.id, name: r.name }));
    },
    getProjectContext(projectId) {
      const project = ctx.projectRepo.findById(projectId);
      if (!project) return null;
      return { id: project.id, name: project.name };
    },

    // ── File system (capabilities-gated) ──
    readFile: caps.files?.read
      ? shared.readFile
      : stub('File read'),
    writeFile: caps.files?.write
      ? shared.writeFile
      : stub('File write'),
    editFile: caps.files?.write
      ? shared.editFile
      : stub('File edit'),
    applyPatch: caps.files?.write
      ? shared.applyPatch
      : stub('Patch application'),
    moveFile: caps.files?.write
      ? shared.moveFile
      : stub('File move'),
    copyFile: caps.files?.write
      ? shared.copyFile
      : stub('File copy'),
    makeDirectory: caps.files?.write
      ? shared.makeDirectory
      : stub('Directory creation'),
    fileInfo: caps.files?.read
      ? shared.fileInfo
      : stub('File info'),
    listDirectory: caps.files?.read
      ? shared.listDirectory
      : stub('Directory listing'),
    searchFiles: caps.files?.read
      ? shared.searchFiles
      : stub('File search'),
    searchContent: caps.files?.read
      ? shared.searchContent
      : stub('Content search'),
    deleteFile: caps.files?.write
      ? shared.deleteFile
      : stub('File deletion'),
    recentFiles: caps.files?.read
      ? shared.recentFiles
      : stub('Recent files'),
    watchFile: caps.files?.read
      ? shared.watchFile
      : stub('File watch'),
    indexProject: caps.knowledge?.index
      ? shared.indexProject
      : stub('Project indexing'),

    // ── Web / HTTP (capabilities-gated) ──
    webFetch: caps.web?.fetch
      ? shared.webFetch
      : stub('Web fetch'),
    httpRequest: caps.web?.http
      ? shared.httpRequest
      : stub('HTTP requests'),

    // ── Shell (capabilities-gated) ──
    execCommand: caps.shell
      ? shared.execCommand
      : stub('Shell execution'),

    // ── Scheduler (capabilities-gated) ──
    scheduleTask: caps.scheduler
      ? shared.scheduleTask
      : stub('Scheduler'),
    listScheduledTasks: caps.scheduler ? shared.listScheduledTasks : async () => [],
    cancelScheduledTask: caps.scheduler
      ? shared.cancelScheduledTask
      : stub('Scheduler'),

    // ── Knowledge / RAG (capabilities-gated) ──
    indexDocument: caps.knowledge?.index
      ? shared.indexDocument
      : stub('Document indexing'),
    searchDocuments: caps.knowledge?.search
      ? shared.searchDocuments
      : stub('Document search'),
    clearDocumentIndex: caps.knowledge?.index
      ? shared.clearDocumentIndex
      : stub('Index management'),

    // ── Evaluation (capabilities-gated) ──
    evaluateOutput: caps.evaluation
      ? shared.evaluateOutput
      : stub('Evaluation'),

    // ── LSP (always available via TypeScript service) ──
    workspaceSymbols: shared.workspaceSymbols,
    goToDefinition: shared.goToDefinition,
    findReferences: shared.findReferences,
    diagnostics: shared.diagnostics,

    // ── System knowledge (always available) ──
    querySystemKnowledge: shared.querySystemKnowledge,
    getSystemKnowledge: shared.getSystemKnowledge,
  };
}

// ── Workflow memory provider (per-run isolation) ──
function buildWorkflowMemoryProvider(runId: string) {
  const ctx = getServerContext();
  return {
    async getShortTerm(_sid: string) {
      return [];
    },
    async getProjectContext(_pid: string) {
      const projCtx = ctx.project.get(_pid);
      if (!projCtx) return `Cabinet v2.0 project. ${_pid}`;
      return `Project: ${projCtx.summary}\nGoals: ${projCtx.goals.join(', ')}`;
    },
    async getEntityPreferences(_captainId: string) {
      const prefs = ctx.entity.getPreferences(_captainId);
      return prefs?.preferences ?? {};
    },
    async searchLongTerm(query: string, _pid: string) {
      let queryEmbedding: number[] | undefined;
      if (ctx.gateway) {
        try {
          const er = await ctx.gateway.generateEmbeddings({ texts: [query] });
          queryEmbedding = er.embeddings[0];
        } catch { /* fall back to text search */ }
      }
      const results = await ctx.longTerm.search(query, 5, queryEmbedding);
      return results.map((r) => `[Memory] ${r.content}`);
    },
  };
}

function getEngine(): WorkflowEngine {
  if (engine) return engine;
  const ctx = getServerContext();
  engine = new WorkflowEngine();
  engine.setDb(ctx.db);

  engine.setHandlers({
    // ── Segment-based agent execution (new) ──
    createAgentLoop: async (agentId, runId, options): Promise<AgentLoopHandle> => {
      if (!ctx.gateway) throw new Error('No LLM gateway available');

      const registry = ctx.agentRegistry;
      const role = registry.get(agentId);
      if (!role) throw new Error(`Agent not found: ${agentId}`);

      const cacheKey = `${runId}:${agentId}`;

      // Check pool first (persistent agents reuse their instance; default persistent=true)
      if (options.persistent !== false) {
        const cached = agentLoopPool.get(cacheKey);
        if (cached) {
          // Move to end (MRU)
          agentLoopPool.delete(cacheKey);
          agentLoopPool.set(cacheKey, cached);
          return {
            async run(message: string) {
              const result = await cached.run(message);
              return result.content;
            },
            async dispose() {
              cached.resetHandoff();
            },
            async handoff() {
              return cached.generateHandoff();
            },
          };
        }
      }

      // Reuse a cached ToolExecutor for the same capabilities (avoid re-registering all tools)
      const capsKey = JSON.stringify(pendingCapabilities);
      let baseExecutor = toolExecutorCache.get(capsKey);
      if (!baseExecutor) {
        baseExecutor = new ToolExecutor();
        registerCabinetTools(baseExecutor, buildToolDependencies(pendingCapabilities));
        registerSkillTools(baseExecutor);
        const mcpCtx = getServerContext();
        registerMCPTools(baseExecutor, (name, args) => mcpCtx.mcpManager.callTool(name, args), () => mcpCtx.mcpManager.listTools());
        baseExecutor.setToolCallCallback((toolName, success, blocked, durationMs) => {
          ctx.observability.recordToolCall(toolName, success, blocked, durationMs);
        });
        toolExecutorCache.set(capsKey, baseExecutor);
      }

      // Create a filtered view instead of rebuilding the tool registry
      const executor = role.allowedTools.length > 0
        ? baseExecutor.createView(role.allowedTools)
        : baseExecutor;

      const checkpointManager = new CheckpointManager(ctx.db);
      const loop = new AgentLoop({
        gateway: ctx.gateway,
        toolExecutor: executor,
        safetyChecker: new SafetyChecker(ctx.delegationTier),
        checkpointManager,
        memoryProvider: buildWorkflowMemoryProvider(runId),
        sessionId: cacheKey,
        projectId: 'default',
        captainId: DEFAULT_CAPTAIN_ID,
        systemPrompt: buildEnvironmentSection() + '\n\n' + role.systemPrompt,
        model: role.model,
        maxSteps: options.persistent !== false ? 20 : 50,
        maxResponseTokens: role.maxResponseTokens,
        temperature: role.temperature,
        contextBudget: role.contextBudget,
      });

      // Add to pool with LRU eviction
      if (options.persistent !== false) {
        if (agentLoopPool.size >= AGENT_LOOP_POOL_MAX) {
          const firstKey = agentLoopPool.keys().next().value;
          if (firstKey) {
            agentLoopPool.get(firstKey)?.resetHandoff();
            agentLoopPool.delete(firstKey);
          }
        }
        agentLoopPool.set(cacheKey, loop);
      }

      return {
        async run(message: string) {
          const result = await loop.run(message);
          ctx.metrics.increment('llm_call', { model: role.model, purpose: 'workflow_segment' });
          return result.content;
        },
        async dispose() {
          loop.resetHandoff();
          if (options.persistent === false) {
            agentLoopPool.delete(cacheKey);
          }
        },
        async handoff() {
          return loop.generateHandoff();
        },
      };
    },

    // ── Legacy aiAgent handler (fallback for nodes without agentId) ──
    aiAgent: async (node: WorkflowNodeDef, _previousOutputs: string) => {
      if (!ctx.gateway) return 'No LLM available';
      const d = node.data ?? {};
      try {
        const response = await ctx.gateway.generateText({
          model: (d.model as string) ?? 'claude-haiku-4-5',
          messages: [{ role: 'user', content: (d.prompt as string) ?? (d.label as string) ?? 'Process this step' }],
          maxTokens: (d.maxTokens as number) ?? 200,
        });
        ctx.metrics.increment('llm_call', { model: (d.model as string) ?? 'claude-haiku-4-5', purpose: 'workflow_legacy' });
        return response.content;
      } catch (e: any) {
        return `Error: ${e.message}`;
      }
    },

    humanApproval: async (node: WorkflowNodeDef, run: WorkflowRun) => {
      const { decisionService, auditLogRepo } = getServerContext();
      const d = node.data ?? {};
      const decisionId = `dec_${Date.now()}`;

      decisionService.create({
        id: decisionId,
        projectId: 'default',
        type: 'action',
        title: `Workflow: ${(d.label as string) ?? node.id}`,
        description: `Workflow needs your approval at: ${(d.label as string) ?? node.id}.`,
        options: [
          { id: 'approve_continue', label: 'Approve & Continue', impact: 'Workflow proceeds to next step.' },
          { id: 'reject_terminate', label: 'Terminate', impact: 'Workflow stops immediately.' },
        ],
        classification: {
          scopeDescription: 'Workflow human approval',
          isCrossSession: true,
          optionCount: 2,
          estimatedCostUsd: 0,
          involvesFunds: false,
          involvesPermissions: false,
          involvesDataDeletion: false,
          involvesOrgConfig: false,
        },
      });

      auditLogRepo.insert('workflow_approval', decisionId, 'pending', 'system', { workflowId: run.workflowId, nodeId: node.id });

      broadcast('decision_created', {
        decisionId,
        title: `Workflow: ${(d.label as string) ?? node.id}`,
        level: 'L1',
      });

      return { decisionId, status: 'pending' as const };
    },

    skill: async (skillId: string, input: unknown) => {
      const { skillRegistry } = getServerContext();
      const skill = skillRegistry.load(skillId);
      if (!skill) return `Skill not found: ${skillId}`;
      const result = await skillRegistry.executeSkill(skill, input as Record<string, unknown> ?? {});
      return result.output;
    },

    notification: async (node: WorkflowNodeDef) => {
      const d = node.data ?? {};
      broadcast('workflow_notification', {
        workflowId: '',
        nodeId: node.id,
        message: (d.message as string) ?? 'Notification sent',
      });
    },
  });

  return engine;
}

export const workflowsRouter = new Hono();

// ── Helpers ──

/**
 * Convert declarative WorkflowDefinition steps to internal node/edge DAG format.
 *
 * Declarative step format (canonical, designed for LLM generation):
 *   { id, type, title, description, prompt, agent, input?, condition?, approvalOptions?,
 *     constraints?, parallel?, template?, capabilities? }
 *
 * Edge generation rules:
 *   - input.from === "trigger" or absent → entry point (no incoming edge)
 *   - input.from === otherStepId → explicit edge from that step
 *   - Absent input.from → sequential (connect from previous non-condition step)
 *   - condition steps → no sequential out-edges; trueBranch/falseBranch create explicit edges
 *   - humanApproval with retryTarget → condition edge back to retry target
 */
function convertStepsToNodes(steps: any[]): { nodes: WorkflowNodeDef[]; edges: WorkflowEdge[] } {
  const nodes: WorkflowNodeDef[] = [];
  const edges: WorkflowEdge[] = [];
  const nodeIds = new Set<string>(steps.map((s) => s.id));

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const prevStep = i > 0 ? steps[i - 1] : null;

    nodes.push({
      id: step.id,
      type: step.type ?? 'aiAgent',
      title: step.title,
      skillId: step.skillId,
      condition: step.condition?.expression ?? step.condition,
      data: {
        label: step.title,
        prompt: step.prompt ?? step.description,
        model: step.constraints?.model,
        maxTokens: step.constraints?.maxTokens,
        temperature: step.constraints?.temperature,
        maxRetries: step.constraints?.maxRetries,
        aggregation: step.parallel?.aggregation,
        message: step.notification?.message,
        template: step.template,
      },
      agentId: step.agent,
      agentConfig: {
        persistent: step.constraints?.persistent,
        segmentId: step.constraints?.segmentId,
      },
    });

    // ── Edge generation ──

    // Condition nodes: explicit branches only, no auto-sequencing
    if (step.type === 'condition') {
      const cond = step.condition ?? {};
      if (cond.trueBranch && nodeIds.has(cond.trueBranch)) {
        edges.push({ from: step.id, to: cond.trueBranch, condition: 'true' });
      }
      if (cond.falseBranch && nodeIds.has(cond.falseBranch)) {
        edges.push({ from: step.id, to: cond.falseBranch, condition: 'false' });
      }
      // If no branches specified, it's a sequential condition — connect to next step
      if (!cond.trueBranch && !cond.falseBranch && prevStep) {
        // Don't auto-connect — condition with no branches is a no-op
      }
      continue;
    }

    // Explicit input.from
    if (step.input?.from) {
      const fromId = step.input.from as string;
      if (fromId !== 'trigger' && nodeIds.has(fromId)) {
        // Check if an edge already exists from this source to this target
        const exists = edges.some((e) => e.from === fromId && e.to === step.id);
        if (!exists) {
          edges.push({ from: fromId, to: step.id });
        }
      }
      // fromId === "trigger" → entry point, no incoming edge
      continue;
    }

    // Default: sequential connection from previous step
    // Skip if previous was a condition (condition handles its own edges)
    const prevIsCondition = prevStep?.type === 'condition';
    const prevConditionHandlesThis = prevIsCondition &&
      (prevStep?.condition?.trueBranch === step.id || prevStep?.condition?.falseBranch === step.id);

    if (prevStep && !prevIsCondition) {
      edges.push({ from: prevStep.id, to: step.id });
    } else if (prevStep && prevIsCondition && !prevConditionHandlesThis) {
      // Previous was condition but this step isn't a branch target — connect anyway
      edges.push({ from: prevStep.id, to: step.id });
    }

    // humanApproval retry target
    if (step.type === 'humanApproval' && step.approvalOptions?.retryTarget) {
      const retryId = step.approvalOptions.retryTarget as string;
      if (nodeIds.has(retryId)) {
        edges.push({ from: step.id, to: retryId, condition: 'retry' });
      }
    }
  }

  return { nodes, edges };
}

function normalizeDefinition(def: any): { nodes: WorkflowNodeDef[]; edges: WorkflowEdge[] } {
  // New format: WorkflowDefinition with steps array
  if (def.steps && Array.isArray(def.steps)) {
    return convertStepsToNodes(def.steps);
  }

  // Legacy format: { nodes, edges }
  const rawNodes: any[] = def.nodes ?? [];
  const rawEdges: any[] = def.edges ?? [];

  const nodes: WorkflowNodeDef[] = rawNodes.map((n: any) => ({
    id: n.id,
    type: n.type ?? n.data?.type ?? 'skill',
    skillId: n.skillId ?? n.data?.skillId,
    condition: n.condition ?? n.data?.condition,
    title: n.title ?? n.data?.label ?? n.data?.title,
    children: n.children ?? n.data?.children,
    data: n.data ?? {},
    agentId: n.agentId ?? n.data?.agentId,
    agentConfig: n.agentConfig ?? n.data?.agentConfig,
  }));

  const edges: WorkflowEdge[] = rawEdges.map((e: any) => ({
    from: e.from ?? e.source,
    to: e.to ?? e.target,
    condition: e.condition,
  }));

  return { nodes, edges };
}

function findEntryNode(nodes: WorkflowNodeDef[]): string {
  const start = nodes.find((n) => n.type === 'start');
  if (start) return start.id;
  return nodes[0]?.id ?? '';
}

// ── Workflow resumption (called by decision callback) ──
export async function resumeWorkflowAfterApproval(workflowId: string): Promise<void> {
  const { workflowRepo, auditLogRepo, logger } = getServerContext();

  const wf = workflowRepo.findById(workflowId);
  if (!wf) throw new Error(`Workflow not found: ${workflowId}`);

  const def = JSON.parse(wf.definition ?? '{}');
  const { nodes, edges } = normalizeDefinition(def);

  const approvalNode = nodes.find((n) => n.type === 'humanApproval');
  if (!approvalNode) {
    logger.warn('No approval node found for resume', { workflowId });
    return;
  }

  // Find the latest incomplete run for this workflow to resume
  const incompleteRuns = workflowRepo.findRunsByWorkflow(workflowId)
    .filter((r) => r.status === 'awaiting_approval' || r.status === 'paused' || r.status === 'running')
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  const latestRun = incompleteRuns[0];
  if (!latestRun) {
    logger.warn('No incomplete run found for resume', { workflowId });
    return;
  }

  const eng = getEngine();
  let run = await eng.continueRun(latestRun.run_id, nodes, edges);

  const finalStatus: string = run.status === 'awaiting_approval' ? 'awaiting_approval' : 'completed';
  workflowRepo.updateStatus(workflowId, finalStatus);
  auditLogRepo.insert('workflow', workflowId, 'resume', 'system', { status: finalStatus, steps: run.steps, runId: run.runId });

  logger.info('Workflow resumed after approval', { workflowId, nodes: run.steps.length, status: finalStatus });
}

// ── Approval polling (fallback when WebSocket event is missed) ──

let approvalPollTimer: ReturnType<typeof setInterval> | null = null;

export function startApprovalPolling(intervalMs: number = 30_000): void {
  if (approvalPollTimer) return; // already running

  approvalPollTimer = setInterval(async () => {
    try {
      const { workflowRepo, auditLogRepo, decisionRepo, db, logger } = getServerContext();

      // Find workflows stuck in awaiting_approval state
      const runs = workflowRepo.findRunsByStatus(['awaiting_approval']);

      for (const runRow of runs) {
        const wfId = runRow.workflow_id;
        // Check if there's a pending approval record for this workflow
        const approvalRow = db
          .prepare(
            "SELECT * FROM audit_log WHERE entity_type = 'workflow_approval' AND action = 'pending' AND json_extract(changes, '$.workflowId') = ? ORDER BY timestamp DESC LIMIT 1",
          )
          .get(wfId) as any;

        if (!approvalRow) continue;

        const changes = JSON.parse(approvalRow.changes ?? '{}');
        const decisionId = changes.decisionId as string | undefined;
        if (!decisionId) continue;

        // Check if the associated decision has been resolved
        const decision = decisionRepo.get(decisionId);

        if (decision && (decision.status === 'approved' || decision.status === 'rejected')) {
          logger.info('Workflow approval resolved via polling', { workflowId: wfId, decisionId, status: decision.status });
          try {
            if (decision.status === 'approved') {
              await resumeWorkflowAfterApproval(wfId);
            } else {
              // Rejected — mark workflow as failed
              workflowRepo.updateStatus(wfId, 'failed');
              workflowRepo.failAwaitingRuns(wfId);
            }
            // Mark approval as resolved
            auditLogRepo.insert('workflow_approval', approvalRow.entity_id, 'resolved', 'system', { workflowId: wfId, status: 'resolved' });
          } catch (err) {
            logger.error('Failed to resume workflow after approval', { workflowId: wfId, error: (err as Error).message });
          }
        }
      }
    } catch (err) {
      // Non-fatal — polling continues on next interval
    }
  }, intervalMs);
}

export function stopApprovalPolling(): void {
  if (approvalPollTimer) {
    clearInterval(approvalPollTimer);
    approvalPollTimer = null;
  }
}

// ── Routes ──

workflowsRouter.get('/', (c) => {
  const { workflowRepo } = getServerContext();
  const projectId = c.req.query('projectId');
  const rows = projectId
    ? workflowRepo.listByProject(projectId)
    : workflowRepo.listAll();
  const workflows = rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    definition: JSON.parse(r.definition ?? '{}'),
    projectId: r.project_id,
    createdAt: r.created_at,
  }));
  return c.json({ workflows });
});

workflowsRouter.post('/', async (c) => {
  const { workflowRepo } = getServerContext();
  const body = await c.req.json();
  if (!body.projectId) {
    return c.json({ error: 'projectId is required' }, 400);
  }
  const id = `wf_${Date.now()}`;
  const definition = body.definition ?? { nodes: body.nodes ?? [], edges: body.edges ?? [] };
  try {
    workflowRepo.create(id, body.projectId, body.name ?? 'Untitled', JSON.stringify(definition), 'draft');
    return c.json({ id, status: 'created' });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

workflowsRouter.put('/:id', async (c) => {
  const { workflowRepo } = getServerContext();
  const id = c.req.param('id');
  const body = await c.req.json();
  workflowRepo.updateNameAndDefinition(
    id,
    body.name ?? 'Untitled',
    JSON.stringify(body.definition ?? {}),
  );
  return c.json({ id, status: 'updated' });
});

workflowsRouter.post('/:id/run', async (c) => {
  const { workflowRepo, auditLogRepo, logger } = getServerContext();
  const id = c.req.param('id');

  const wf = workflowRepo.findById(id);
  if (!wf) return c.json({ error: 'Workflow not found' }, 404);

  const def = JSON.parse(wf.definition ?? '{}');
  const { nodes, edges } = normalizeDefinition(def);

  // Cache capabilities for createAgentLoop
  pendingCapabilities = (def.capabilities as WorkflowCapabilities) ?? {};
  capabilityCache.set(id, pendingCapabilities);

  if (nodes.length === 0) {
    return c.json({ error: 'Workflow has no nodes' }, 400);
  }

  workflowRepo.updateStatus(id, 'running');

  const eng = getEngine();
  const entryNodeId = findEntryNode(nodes);

  try {
    const run = await eng.startRun(id, nodes, edges, entryNodeId);

    const finalStatus = run.status;
    workflowRepo.updateStatus(id, finalStatus);
    auditLogRepo.insert('workflow', id, 'run', 'system', { status: finalStatus, steps: run.steps, runId: run.runId });

    // Collect handoff docs from segment boundaries
    const handoffs: Record<string, unknown> = {};
    for (const [key, value] of run.results) {
      if (key.startsWith('_handoff:')) {
        handoffs[key.replace('_handoff:', '')] = value;
      }
    }

    broadcast('workflow_started', {
      workflowId: id,
      runId: run.runId,
      name: wf.name,
      timestamp: new Date().toISOString(),
    });
    broadcast('workflow_completed', {
      workflowId: id,
      runId: run.runId,
      status: finalStatus,
      timestamp: new Date().toISOString(),
    });
    logger.info('Workflow executed', { id, nodes: run.steps.length, status: finalStatus, segments: Object.keys(handoffs).length });
    return c.json({
      runId: run.runId,
      workflowId: id,
      status: finalStatus,
      steps: run.steps,
      handoffs: Object.keys(handoffs).length > 0 ? handoffs : undefined,
    });
  } catch (e) {
    workflowRepo.updateStatus(id, 'failed');
    broadcast('workflow_completed', {
      workflowId: id,
      runId: '',
      status: 'failed',
      timestamp: new Date().toISOString(),
    });
    return c.json({ error: (e as Error).message }, 500);
  } finally {
    // Clean up agentLoop pool entries for this workflow run to prevent unbounded growth
    const runPrefix = `run_`;
    for (const key of agentLoopPool.keys()) {
      if (key.startsWith(runPrefix)) {
        agentLoopPool.get(key)?.resetHandoff();
        agentLoopPool.delete(key);
      }
    }
  }
});

workflowsRouter.delete('/:id', (c) => {
  const { workflowRepo, logger } = getServerContext();
  const id = c.req.param('id');
  workflowRepo.delete(id);
  logger.info('Workflow deleted', { id });
  return c.json({ status: 'deleted' });
});

workflowsRouter.get('/:id/runs', (c) => {
  const { auditLogRepo } = getServerContext();
  const id = c.req.param('id');
  const rows = auditLogRepo.findByEntity('workflow', id, { limit: 20 });
  const runs = rows.map((r) => ({
    runId: r.id,
    workflowId: id,
    status: JSON.parse(r.changes ?? '{}').status ?? 'completed',
    steps: JSON.parse(r.changes ?? '{}').steps ?? [],
    timestamp: r.timestamp,
  }));
  return c.json({ runs, total: runs.length });
});
