/* eslint-disable @typescript-eslint/no-explicit-any */
import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import { broadcast } from '../ws/handler.js';
import {
  WorkflowEngine,
  type WorkflowNodeDef,
  type WorkflowEdge,
  type WorkflowRun,
  type AgentLoopHandle,
} from '@cabinet/workflow';
import { DEFAULT_CAPTAIN_ID, type WorkflowNodeType } from '@cabinet/types';
import {
  AgentLoop,
  ToolExecutor,
  SafetyChecker,
  CheckpointManager,
  registerCabinetTools,
  registerSkillTools,
  registerMCPTools,
  CliAdapter,
  A2AConnector,
} from '@cabinet/agent';
import type { ToolDependencies } from '@cabinet/agent';
import type { WorkflowCapabilities } from '@cabinet/types';
import {
  createAllCapabilities,
  buildEnvironmentSection,
  type CapabilitiesContext,
} from '../capabilities.js';

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
  return (async () => {
    throw new Error(msg);
  }) as unknown as T;
}

// ── Tool dependencies (capabilities-gated for workflow agents) ──
function buildToolDependencies(caps: WorkflowCapabilities = {}): ToolDependencies {
  const ctx = getServerContext();
  const capabilitiesCtx: CapabilitiesContext = {
    db: ctx.db,
    gateway: ctx.gateway,
    logger: ctx.logger,
    taskScheduler: ctx.taskScheduler,
    workflowRepo: ctx.workflowRepo,
    projectRepo: ctx.projectRepo,
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
      const rows = ctx.workflowRepo.listAll();
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
      return {
        id: row.id,
        name: row.name,
        definition: JSON.parse(row.definition ?? '{}'),
        status: row.status,
      };
    },
    createWorkflow(input) {
      const id = `wf_${Date.now()}`;
      const cronExpr = (input as any).cronExpression as string | undefined;
      ctx.workflowRepo.create(
        id,
        input.projectId ?? 'default',
        input.name,
        JSON.stringify(input.definition ?? {}),
        'draft',
        cronExpr,
      );
      if (cronExpr) {
        ctx.taskScheduler.schedule(id, input.name, cronExpr);
      }
      return { id, cronExpression: cronExpr ?? null };
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
      let embedding: number[] | undefined;
      if (ctx.gateway) {
        try {
          const result = await ctx.gateway.generateEmbeddings({ texts: [content] });
          embedding = result.embeddings[0];
        } catch {
          /* embedding generation failed — store without */
        }
      }
      return ctx.longTerm.store({
        content,
        metadata: metadata ?? {},
        embedding,
        timestamp: new Date(),
      });
    },
    createEmployee(_input) {},
    registerAgent(input) {
      ctx.agentRegistry.register({
        type: 'custom' as const,
        name: input.name,
        description: input.description,
        modules: { identity: input.systemPrompt },
        modelTier: (((input as any).modelTier as string) || 'default') as any,
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
        type: r.type,
        name: r.name,
        description: r.description,
        builtIn: r.type !== 'custom',
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

    getDashboardStats() {
      const pendingDecisions = ctx.decisionRepo.countByStatus('pending');
      const activeWorkflows = ctx.workflowRepo.countByStatus(['running']);
      const activeProjects = ctx.projectRepo.listAll().filter((p) => !p.archived).length;
      const todayCost = ctx.costTracker.getDailyCost();
      const summary = ctx.metrics.getSummary();
      return {
        pendingDecisions,
        activeWorkflows,
        activeProjects,
        todayCost,
        totalLLMCalls: summary.totalLLMCalls,
        totalTokens: summary.totalTokens,
        totalDecisions: summary.totalDecisions,
        errors: summary.errors,
        recentEvents: [],
      };
    },
    delegateTask(name) {
      return ctx.taskTracker.addTask(name);
    },
    getTaskStatus(taskId) {
      const task = ctx.taskTracker.getTask(taskId);
      if (!task) return null;
      return {
        id: task.id,
        name: task.name,
        status: task.status,
        startTime: task.startTime,
        endTime: task.endTime,
      };
    },
    listActiveTasks() {
      return ctx.taskTracker
        .listActive()
        .map((t) => ({ id: t.id, name: t.name, status: t.status }));
    },
    getDecisionAudit(decisionId) {
      const rows = ctx.auditLogRepo.findByEntity('decision', decisionId);
      return rows.map((r) => ({
        action: r.action,
        actor: r.actor,
        changes: (() => {
          try {
            return JSON.parse(r.changes ?? '{}');
          } catch {
            return {};
          }
        })(),
        timestamp: r.timestamp,
      }));
    },
    getSystemMetrics() {
      return ctx.metrics.getSummary();
    },
    generateEmbeddings: async (texts) => {
      if (!ctx.gateway) throw new Error('No LLM gateway available');
      const result = await ctx.gateway.generateEmbeddings({ texts });
      return result.embeddings;
    },
    getWorkflowRun(runId) {
      const row = ctx.workflowRepo.findRunById(runId);
      if (!row) return null;
      let steps: unknown[] = [];
      try {
        steps = ctx.workflowRepo.findStepsByRunId(runId);
      } catch {
        /* non-fatal */
      }
      return {
        runId: row.run_id,
        workflowId: row.workflow_id,
        status: row.status,
        steps,
        startedAt: row.started_at,
        updatedAt: row.updated_at,
      };
    },
    listWorkflowRuns(workflowId) {
      const rows = ctx.workflowRepo.findRunsByWorkflow(workflowId);
      return rows.map((r) => ({
        runId: r.run_id,
        workflowId: r.workflow_id,
        status: r.status,
        startedAt: r.started_at,
        updatedAt: r.updated_at,
      }));
    },

    // ── File system (capabilities-gated) ──
    readFile: caps.files?.read ? shared.readFile : stub('File read'),
    writeFile: caps.files?.write ? shared.writeFile : stub('File write'),
    editFile: caps.files?.write ? shared.editFile : stub('File edit'),
    applyPatch: caps.files?.write ? shared.applyPatch : stub('Patch application'),
    moveFile: caps.files?.write ? shared.moveFile : stub('File move'),
    copyFile: caps.files?.write ? shared.copyFile : stub('File copy'),
    makeDirectory: caps.files?.write ? shared.makeDirectory : stub('Directory creation'),
    fileInfo: caps.files?.read ? shared.fileInfo : stub('File info'),
    listDirectory: caps.files?.read ? shared.listDirectory : stub('Directory listing'),
    searchFiles: caps.files?.read ? shared.searchFiles : stub('File search'),
    searchContent: caps.files?.read ? shared.searchContent : stub('Content search'),
    deleteFile: caps.files?.write ? shared.deleteFile : stub('File deletion'),
    recentFiles: caps.files?.read ? shared.recentFiles : stub('Recent files'),
    watchFile: caps.files?.read ? shared.watchFile : stub('File watch'),
    indexProject: caps.knowledge?.index ? shared.indexProject : stub('Project indexing'),

    // ── Web / HTTP (capabilities-gated) ──
    webFetch: caps.web?.fetch ? shared.webFetch : stub('Web fetch'),
    httpRequest: caps.web?.http ? shared.httpRequest : stub('HTTP requests'),

    // ── Shell (capabilities-gated) ──
    execCommand: caps.shell ? shared.execCommand : stub('Shell execution'),

    // ── Scheduler (always enabled) ──
    scheduleTask: shared.scheduleTask,
    listScheduledTasks: shared.listScheduledTasks,
    cancelScheduledTask: shared.cancelScheduledTask,

    // ── Knowledge / RAG (capabilities-gated) ──
    indexDocument: caps.knowledge?.index ? shared.indexDocument : stub('Document indexing'),
    searchDocuments: caps.knowledge?.search ? shared.searchDocuments : stub('Document search'),
    clearDocumentIndex: caps.knowledge?.index
      ? shared.clearDocumentIndex
      : stub('Index management'),

    // ── Evaluation (capabilities-gated) ──
    evaluateOutput: caps.evaluation ? shared.evaluateOutput : stub('Evaluation'),

    // ── LSP (always available via TypeScript service) ──
    workspaceSymbols: shared.workspaceSymbols,
    goToDefinition: shared.goToDefinition,
    findReferences: shared.findReferences,
    diagnostics: shared.diagnostics,

    // ── System knowledge (always available) ──
    querySystemKnowledge: shared.querySystemKnowledge,
    getSystemKnowledge: shared.getSystemKnowledge,

    // ── Document (capabilities-gated under files) ──
    readPdf: caps.files?.read ? shared.readPdf : stub('PDF read'),
    readDocx: caps.files?.read ? shared.readDocx : stub('DOCX read'),
    readXlsx: caps.files?.read ? shared.readXlsx : stub('XLSX read'),
    readPptx: caps.files?.read ? shared.readPptx : stub('PPTX read'),

    // ── Archive (capabilities-gated under files) ──
    listZip: caps.files?.read ? shared.listZip : stub('ZIP listing'),
    extractZip: caps.files?.write ? shared.extractZip : stub('ZIP extraction'),

    // ── Browser (capabilities-gated under web) ──
    browserNavigate: caps.web?.fetch ? shared.browserNavigate : stub('Browser navigation'),
    browserClick: caps.web?.fetch ? shared.browserClick : stub('Browser click'),
    browserType: caps.web?.fetch ? shared.browserType : stub('Browser type'),
    browserRead: caps.web?.fetch ? shared.browserRead : stub('Browser read'),
    browserScreenshot: caps.web?.fetch ? shared.browserScreenshot : stub('Browser screenshot'),
    browserEvaluate: caps.web?.fetch ? shared.browserEvaluate : stub('Browser evaluate'),

    // ── Communication (capabilities-gated under web) ──
    fetchRss: caps.web?.fetch ? shared.fetchRss : stub('RSS fetch'),
    sendEmail: caps.web?.fetch ? shared.sendEmail : stub('Email send'),

    // ── System (always available) ──
    readClipboard: shared.readClipboard,
    writeClipboard: shared.writeClipboard,
    sendNotification: shared.sendNotification,
    startProcess: shared.startProcess,
    killProcess: shared.killProcess,
    showOpenDialog: shared.showOpenDialog,
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
        } catch {
          /* fall back to text search */
        }
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
        registerMCPTools(
          baseExecutor,
          (name, args) => mcpCtx.mcpManager.callTool(name, args),
          () => mcpCtx.mcpManager.listTools(),
        );
        baseExecutor.setToolCallCallback((toolName, success, blocked, durationMs) => {
          ctx.observability.recordToolCall(toolName, success, blocked, durationMs);
        });
        toolExecutorCache.set(capsKey, baseExecutor);
      }

      // Create a filtered view instead of rebuilding the tool registry
      const executor =
        role.allowedTools.length > 0 ? baseExecutor.createView(role.allowedTools) : baseExecutor;

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
        systemPrompt: buildEnvironmentSection() + '\n\n' + role.modules.identity,
        model: (ctx.gateway as any).resolveModelString?.(role.modelTier) ?? role.modelTier,
        maxSteps: options.persistent !== false ? 20 : 50,
        maxResponseTokens: role.maxResponseTokens,
        temperature: role.temperature,
        contextBudget: role.contextBudget,
        toolPruner: undefined, // removed from ServerContext — fixed small tool set
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
          ctx.metrics.increment('llm_call', {
            model: (ctx.gateway as any).resolveModelString?.(role.modelTier) ?? role.modelTier,
            purpose: 'workflow_segment',
          });
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
          messages: [
            {
              role: 'user',
              content: (d.prompt as string) ?? (d.label as string) ?? 'Process this step',
            },
          ],
          maxTokens: (d.maxTokens as number) ?? 200,
        });
        ctx.metrics.increment('llm_call', {
          model: (d.model as string) ?? 'claude-haiku-4-5',
          purpose: 'workflow_legacy',
        });
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
          {
            id: 'approve_continue',
            label: 'Approve & Continue',
            impact: 'Workflow proceeds to next step.',
          },
          { id: 'reject_terminate', label: 'Terminate', impact: 'Workflow stops immediately.' },
        ],
        classification: {
          scopeDescription: 'Workflow human approval',
          isCrossSession: true,
          optionCount: 2,
          estimatedCost: 0,
          involvesFunds: false,
          involvesPermissions: false,
          involvesDataDeletion: false,
          involvesOrgConfig: false,
        },
      });

      auditLogRepo.insert('workflow_approval', decisionId, 'pending', 'system', {
        workflowId: run.workflowId,
        nodeId: node.id,
      });

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
      const result = await skillRegistry.executeSkill(
        skill,
        (input as Record<string, unknown>) ?? {},
      );
      return result.output;
    },

    dispatchToExternalAgent: async (agentId, task) => {
      const ctx = getServerContext();
      const registry = ctx.agentRegistry;
      const roleDef = registry.get(agentId);
      if (!roleDef?.external) {
        throw new Error(`Agent ${agentId} has no external config`);
      }

      const ext = roleDef.external;
      // Cache adapters keyed by agentId
      const cacheKey = `wf_adapter:${agentId}`;
      let adapter: any = (engine as any)._adapterCache?.get(cacheKey);
      if (!adapter) {
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
          });
        } else {
          adapter = new A2AConnector(agentId, {
            baseUrl: ext.baseUrl ?? `http://localhost:${agentId}`,
            healthCheckUrl: ext.healthCheckUrl,
            authConfig: ext.authConfig as any,
            timeoutMs: ext.timeoutMs,
            maxRetries: ext.maxRetries,
          });
        }
        if (!(engine as any)._adapterCache) (engine as any)._adapterCache = new Map();
        (engine as any)._adapterCache.set(cacheKey, adapter);
      }

      const result = await adapter.dispatchTask({
        task_id: `${task.runId}_${task.nodeId}`,
        session_id: task.runId,
        capability: 'default',
        input: task.input,
        slot: task.slot,
        configuration: {
          max_retries: ext.maxRetries ?? 2,
          timeout_ms: ext.timeoutMs ?? 120_000,
          slot_write_url: `http://localhost:${process.env.PORT ?? 3000}/api/slot/${task.runId}_${task.nodeId}/write`,
        },
      });

      if (result.status === 'awaiting_approval') {
        return { status: 'awaiting_approval', decisionId: result.decision_id };
      }
      if (result.status === 'timed_out' || result.status === 'failed') {
        return { status: 'failed', output: result.error, decisionId: result.decision_id };
      }
      return { status: 'completed', output: result.output };
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
function normalizeNodeType(type: string | undefined): string {
  switch (type) {
    case 'aiAgent': return 'agentGroup';
    case 'llmCall': return 'llm';
    case 'condition': return 'ifElse';
    case 'humanApproval': return 'approval';
    case 'dataQuery': return 'tool';
    case 'notification': return 'pass';
    case 'wait': return 'pass';
    default: return type ?? 'agentGroup';
  }
}

function convertStepsToNodes(steps: any[]): { nodes: WorkflowNodeDef[]; edges: WorkflowEdge[] } {
  const nodes: WorkflowNodeDef[] = [];
  const edges: WorkflowEdge[] = [];
  const nodeIds = new Set<string>(steps.map((s) => s.id));

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const prevStep = i > 0 ? steps[i - 1] : null;

    // Normalize legacy step type names to current engine node types
    const normalizedType = normalizeNodeType(step.type);

    nodes.push({
      id: step.id,
      type: normalizedType as WorkflowNodeType,
      title: step.title,
      skillId: step.skillId,
      loopCondition: (step as any).condition?.expression ?? (step as any).condition,
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
      role: step.agent,
      persistent: step.constraints?.persistent,
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
    const prevConditionHandlesThis =
      prevIsCondition &&
      (prevStep?.condition?.trueBranch === step.id || prevStep?.condition?.falseBranch === step.id);

    if (prevStep && !prevIsCondition) {
      edges.push({ from: prevStep.id, to: step.id });
    } else if (prevStep && prevIsCondition && !prevConditionHandlesThis) {
      // Previous was condition but this step isn't a branch target — connect anyway
      edges.push({ from: prevStep.id, to: step.id });
    }

    // humanApproval retry target
    if ((step.type === 'approval' || (step.type as string) === 'humanApproval') && (step as any).approvalOptions?.retryTarget) {
      const retryId = step.approvalOptions.retryTarget as string;
      if (nodeIds.has(retryId)) {
        edges.push({ from: step.id, to: retryId, condition: 'retry' });
      }
    }
  }

  return { nodes, edges };
}

export function normalizeDefinition(def: any): { nodes: WorkflowNodeDef[]; edges: WorkflowEdge[] } {
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

  const approvalNode = nodes.find((n) => n.type === 'approval' || (n.type as string) === 'humanApproval');
  if (!approvalNode) {
    logger.warn('No approval node found for resume', { workflowId });
    return;
  }

  // Find the latest incomplete run for this workflow to resume
  const incompleteRuns = workflowRepo
    .findRunsByWorkflow(workflowId)
    .filter(
      (r) => r.status === 'awaiting_approval' || r.status === 'paused' || r.status === 'running',
    )
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  const latestRun = incompleteRuns[0];
  if (!latestRun) {
    logger.warn('No incomplete run found for resume', { workflowId });
    return;
  }

  const eng = getEngine();
  const run = await eng.continueRun(latestRun.run_id, nodes, edges);

  const finalStatus: string =
    run.status === 'awaiting_approval' ? 'awaiting_approval' : 'completed';
  workflowRepo.updateStatus(workflowId, finalStatus);
  auditLogRepo.insert('workflow', workflowId, 'resume', 'system', {
    status: finalStatus,
    steps: run.steps,
    runId: run.runId,
  });

  logger.info('Workflow resumed after approval', {
    workflowId,
    nodes: run.steps.length,
    status: finalStatus,
  });
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
          logger.info('Workflow approval resolved via polling', {
            workflowId: wfId,
            decisionId,
            status: decision.status,
          });
          try {
            if (decision.status === 'approved') {
              await resumeWorkflowAfterApproval(wfId);
            } else {
              // Rejected — mark workflow as failed
              workflowRepo.updateStatus(wfId, 'failed');
              workflowRepo.failAwaitingRuns(wfId);
            }
            // Mark approval as resolved
            auditLogRepo.insert('workflow_approval', approvalRow.entity_id, 'resolved', 'system', {
              workflowId: wfId,
              status: 'resolved',
            });
          } catch (err) {
            logger.error('Failed to resume workflow after approval', {
              workflowId: wfId,
              error: (err as Error).message,
            });
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
  const rows = projectId ? workflowRepo.listByProject(projectId) : workflowRepo.listAll();
  const workflows = rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    definition: JSON.parse(r.definition ?? '{}'),
    projectId: r.project_id,
    cronExpression: r.cron_expression ?? null,
    createdAt: r.created_at,
  }));
  return c.json({ workflows });
});

workflowsRouter.post('/', async (c) => {
  const { workflowRepo, taskScheduler } = getServerContext();
  const body = await c.req.json();
  if (!body.projectId) {
    return c.json({ error: 'projectId is required' }, 400);
  }
  const id = `wf_${Date.now()}`;
  const definition = body.definition ?? { nodes: body.nodes ?? [], edges: body.edges ?? [] };
  const cronExpression: string | undefined = body.cronExpression;
  try {
    workflowRepo.create(
      id,
      body.projectId,
      body.name ?? 'Untitled',
      JSON.stringify(definition),
      'draft',
      cronExpression,
    );
    if (cronExpression) {
      taskScheduler.schedule(id, body.name ?? 'Untitled', cronExpression);
    }
    return c.json({ id, status: 'created' });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

workflowsRouter.put('/:id', async (c) => {
  const { workflowRepo, taskScheduler } = getServerContext();
  const id = c.req.param('id');
  const body = await c.req.json();
  workflowRepo.updateNameAndDefinition(
    id,
    body.name ?? 'Untitled',
    JSON.stringify(body.definition ?? {}),
  );
  if (body.cronExpression !== undefined) {
    if (body.cronExpression) {
      taskScheduler.schedule(id, body.name ?? 'Untitled', body.cronExpression as string);
    } else {
      workflowRepo.updateCron(id, null);
      taskScheduler.unschedule(id);
    }
  }
  return c.json({ id, status: 'updated' });
});

/** Run a workflow by ID using the full engine (used by both HTTP API and MCP tool). */
export async function runWorkflowById(workflowId: string): Promise<{
  runId: string;
  status: string;
  steps: unknown[];
  handoffs: Record<string, unknown>;
}> {
  const { workflowRepo, auditLogRepo, logger, db } = getServerContext();
  const wf = workflowRepo.findById(workflowId);
  if (!wf) throw new Error(`Workflow not found: ${workflowId}`);

  const def = JSON.parse(wf.definition ?? '{}');
  const { nodes, edges } = normalizeDefinition(def);

  pendingCapabilities = (def.capabilities as WorkflowCapabilities) ?? {};
  capabilityCache.set(workflowId, pendingCapabilities);

  if (nodes.length === 0) throw new Error('Workflow has no nodes');

  workflowRepo.updateStatus(workflowId, 'running');

  const eng = getEngine();
  const entryNodeId = findEntryNode(nodes);

  const run = await eng.startRun(workflowId, nodes, edges, entryNodeId);

  const finalStatus = run.status;
  workflowRepo.updateStatus(workflowId, finalStatus);
  auditLogRepo.insert('workflow', workflowId, 'run', 'system', {
    status: finalStatus,
    steps: run.steps,
    runId: run.runId,
  });

  const handoffs: Record<string, unknown> = {};
  for (const [key, value] of run.results) {
    if (key.startsWith('_handoff:')) {
      handoffs[key.replace('_handoff:', '')] = value;
    }
  }

  broadcast('workflow_started', {
    workflowId,
    runId: run.runId,
    name: wf.name,
    timestamp: new Date().toISOString(),
  });
  broadcast('workflow_completed', {
    workflowId,
    runId: run.runId,
    status: finalStatus,
    timestamp: new Date().toISOString(),
  });

  // Auto-create deliverable for completed workflows
  if (finalStatus === 'completed') {
    try {
      const deliverableId = `d_${Date.now()}`;
      const lastStep = run.steps[run.steps.length - 1];
      const output = lastStep ? String(lastStep.output ?? '') : '';
      db.prepare(
        `INSERT INTO project_deliverables (id, project_id, meeting_id, title, type, file_path, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        deliverableId,
        wf.project_id,
        null,
        wf.name || `Workflow ${workflowId}`,
        'workflow_output',
        '',
        JSON.stringify(['workflow', 'auto']),
      );
      broadcast('deliverable_created', {
        id: deliverableId,
        projectId: wf.project_id,
        title: wf.name || `Workflow ${workflowId}`,
        type: 'workflow_output',
        timestamp: new Date().toISOString(),
      });
    } catch {
      /* ignore deliverable creation errors */
    }
  }

  logger.info('Workflow executed', {
    id: workflowId,
    nodes: run.steps.length,
    runId: run.runId,
    status: finalStatus,
  });

  return { runId: run.runId, status: finalStatus, steps: run.steps, handoffs };
}

workflowsRouter.post('/:id/run', async (c) => {
  const { workflowRepo, logger } = getServerContext();
  const id = c.req.param('id');

  try {
    const result = await runWorkflowById(id);
    return c.json({
      runId: result.runId,
      workflowId: id,
      status: result.status,
      steps: result.steps,
      handoffs: Object.keys(result.handoffs).length > 0 ? result.handoffs : undefined,
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
  const { workflowRepo, taskScheduler, logger } = getServerContext();
  const id = c.req.param('id');
  taskScheduler.unschedule(id);
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
