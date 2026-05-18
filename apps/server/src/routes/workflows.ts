import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import { broadcast } from '../ws/handler.js';
import { WorkflowEngine, type WorkflowNodeDef, type WorkflowEdge, type WorkflowRun, type AgentLoopHandle } from '@cabinet/workflow';
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

// ── Shared engine instance ──
let engine: WorkflowEngine | null = null;

// ── AgentLoop instance cache (keyed by runId:agentId for isolation) ──
const agentLoopCache = new Map<string, AgentLoop>();

// ── Tool dependencies (focused subset for workflow agents) ──
function buildToolDependencies(): ToolDependencies {
  const ctx = getServerContext();
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
      const rows = ctx.db
        .prepare('SELECT id, name, definition, status FROM workflows WHERE project_id = ? ORDER BY created_at DESC')
        .all('default') as any[];
      return rows.map((r: any) => {
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
      const row = ctx.db
        .prepare('SELECT id, name, definition, status FROM workflows WHERE id = ?')
        .get(id) as any;
      if (!row) return undefined;
      return { id: row.id, name: row.name, definition: JSON.parse(row.definition ?? '{}'), status: row.status };
    },

    createWorkflow(input) {
      const id = `wf_${Date.now()}`;
      ctx.db
        .prepare('INSERT INTO workflows (id, project_id, name, definition, status) VALUES (?, ?, ?, ?, ?)')
        .run(id, input.projectId, input.name, JSON.stringify(input.definition ?? {}), 'draft');
      return { id };
    },
    updateWorkflow(id, input) {
      if (input.name !== undefined || input.definition !== undefined) {
        const name = input.name;
        const definition = input.definition;
        if (name !== undefined && definition !== undefined) {
          ctx.db.prepare('UPDATE workflows SET name = ?, definition = ? WHERE id = ?').run(name, JSON.stringify(definition), id);
        } else if (name !== undefined) {
          ctx.db.prepare('UPDATE workflows SET name = ? WHERE id = ?').run(name, id);
        } else if (definition !== undefined) {
          ctx.db.prepare('UPDATE workflows SET definition = ? WHERE id = ?').run(JSON.stringify(definition), id);
        }
      }
    },
    deleteWorkflow(id) {
      ctx.db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
    },
    async runWorkflow(_id) {
      return { runId: '', status: 'not_implemented' };
    },
    async startMeeting(topic, advisorIds) {
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
      ctx.db.prepare('DELETE FROM agent_roles WHERE name = ?').run(name);
    },
    listAgents() {
      return ctx.agentRegistry.list().map((r) => ({
        type: r.type, name: r.name, description: r.description, builtIn: r.type !== 'custom',
      }));
    },
    // Project tools (stubs — workflow agents don't manage projects)
    setProjectContext(projectId) {
      const row = ctx.db.prepare('SELECT id, name FROM projects WHERE id = ?').get(projectId) as any;
      if (!row) throw new Error(`Project not found: ${projectId}`);
      return { id: row.id, name: row.name };
    },
    createProject(input) {
      const id = `proj_${Date.now()}`;
      ctx.db.prepare('INSERT INTO projects (id, name, description, last_activity_at) VALUES (?, ?, ?, datetime(\'now\'))')
        .run(id, input.name, input.description ?? '', input.rootPath ?? '');
      return { id, name: input.name };
    },
    listProjects() {
      const rows = ctx.db.prepare('SELECT id, name FROM projects WHERE archived = 0 ORDER BY last_activity_at DESC').all() as any[];
      return rows.map((r: any) => ({ id: r.id, name: r.name }));
    },
    getProjectContext(projectId) {
      const project = ctx.db.prepare('SELECT id, name FROM projects WHERE id = ?').get(projectId) as any;
      if (!project) return null;
      return { id: project.id, name: project.name };
    },

    // ── File system callbacks (stubs for workflow agents) ──
    readFile: async (_path: string, _offset?: number, _limit?: number): Promise<{ content: string; size: number; encoding: 'utf-8' | 'base64'; mimeType?: string }> => {
      throw new Error('File access not available in workflow context');
    },
    writeFile: async (_path, _content) => { throw new Error('File access not available in workflow context'); },
    editFile: async (_path, _oldString, _newString) => { throw new Error('File access not available in workflow context'); },
    listDirectory: async (_path) => { throw new Error('File access not available in workflow context'); },
    searchFiles: async (_pattern, _dir) => { throw new Error('File access not available in workflow context'); },
    searchContent: async (_pattern, _dir, _include) => { throw new Error('File access not available in workflow context'); },
    deleteFile: async (_path) => { throw new Error('File access not available in workflow context'); },

    // ── Web / HTTP callbacks ──
    webFetch: async () => { throw new Error('Web access not available in workflow context'); },
    httpRequest: async () => { throw new Error('HTTP access not available in workflow context'); },

    // ── Shell callback ──
    execCommand: async () => { throw new Error('Shell execution not available in workflow context'); },

    // ── Scheduler callbacks ──
    scheduleTask: async () => { throw new Error('Scheduler not available in workflow context'); },
    listScheduledTasks: async () => [],
    cancelScheduledTask: async (_id) => { throw new Error('Scheduler not available in workflow context'); },

    // ── Knowledge / RAG callbacks ──
    indexDocument: async () => { throw new Error('Document indexing not available in workflow context'); },
    searchDocuments: async () => { throw new Error('Document search not available in workflow context'); },
    clearDocumentIndex: async () => { throw new Error('Index management not available in workflow context'); },

    // ── Evaluation callback ──
    evaluateOutput: async () => { throw new Error('Evaluation not available in workflow context'); },
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

      // Check cache first (persistent agents reuse their instance)
      if (options.persistent) {
        const cached = agentLoopCache.get(cacheKey);
        if (cached) {
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

      const executor = new ToolExecutor();
      registerCabinetTools(executor, buildToolDependencies());
      registerSkillTools(executor);
      const mcpCtx = getServerContext();
      registerMCPTools(executor, (name, args) => mcpCtx.mcpManager.callTool(name, args), () => mcpCtx.mcpManager.listTools());

      // Restrict tools per role
      if (role.allowedTools.length > 0) {
        for (const toolName of executor.listTools()) {
          if (!role.allowedTools.includes(toolName)) {
            executor.unregister(toolName);
          }
        }
      }

      const checkpointManager = new CheckpointManager(ctx.db);
      const loop = new AgentLoop({
        gateway: ctx.gateway,
        toolExecutor: executor,
        safetyChecker: new SafetyChecker(ctx.delegationTier),
        checkpointManager,
        memoryProvider: buildWorkflowMemoryProvider(runId),
        sessionId: cacheKey,
        projectId: 'default',
        captainId: 'captain-1',
        systemPrompt: role.systemPrompt,
        model: role.model,
        maxSteps: options.persistent ? 20 : 10,
      });

      // Wire observability
      executor.setToolCallCallback((toolName, success, blocked, durationMs) => {
        ctx.observability.recordToolCall(toolName, success, blocked, durationMs);
      });

      // Cache persistent agents
      if (options.persistent) {
        agentLoopCache.set(cacheKey, loop);
      }

      return {
        async run(message: string) {
          const result = await loop.run(message);
          ctx.metrics.increment('llm_call', { model: role.model, purpose: 'workflow_segment' });
          return result.content;
        },
        async dispose() {
          loop.resetHandoff();
          if (!options.persistent) {
            agentLoopCache.delete(cacheKey);
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
      const { decisionService, db } = getServerContext();
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

      db.prepare(
        "INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp) VALUES ('workflow_approval', ?, 'pending', 'system', ?, datetime('now'))",
      ).run(decisionId, JSON.stringify({ workflowId: run.workflowId, nodeId: node.id }));

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

/** Convert new declarative WorkflowDefinition steps to internal node/edge format. */
function convertStepsToNodes(steps: any[]): { nodes: WorkflowNodeDef[]; edges: WorkflowEdge[] } {
  const nodes: WorkflowNodeDef[] = [];
  const edges: WorkflowEdge[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const prevStep = i > 0 ? steps[i - 1] : null;

    nodes.push({
      id: step.id,
      type: step.type ?? 'aiAgent',
      title: step.title,
      data: {
        label: step.title,
        prompt: step.prompt ?? step.description,
        model: step.constraints?.model,
        maxTokens: step.constraints?.maxTokens,
      },
      agentId: step.agent,
      agentConfig: {
        persistent: step.constraints?.persistent,
      },
    });

    // Generate edges: sequential flow or condition-based
    if (step.type === 'condition' && step.condition) {
      if (step.condition.trueBranch) {
        edges.push({ from: step.id, to: step.condition.trueBranch, condition: 'true' });
      }
      if (step.condition.falseBranch) {
        edges.push({ from: step.id, to: step.condition.falseBranch, condition: 'false' });
      }
    } else if (prevStep && prevStep.type !== 'condition') {
      // Sequential: connect previous step to current
      edges.push({ from: prevStep.id, to: step.id });
    } else if (prevStep && prevStep.type === 'condition') {
      // Previous was condition — don't auto-connect; condition handles its own branches
    } else if (i === 0) {
      // First step — no incoming edge needed (entry point)
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
  const { db, logger } = getServerContext();

  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId) as any;
  if (!wf) throw new Error(`Workflow not found: ${workflowId}`);

  const def = JSON.parse(wf.definition ?? '{}');
  const { nodes, edges } = normalizeDefinition(def);

  const approvalNode = nodes.find((n) => n.type === 'humanApproval');
  if (!approvalNode) {
    logger.warn('No approval node found for resume', { workflowId });
    return;
  }

  const eng = getEngine();
  let run = await eng.startRun(workflowId, nodes, edges, approvalNode.id);

  if (run.status === 'awaiting_approval') {
    run.status = 'running';
    run = await eng.continueRun(run.runId, nodes, edges);
  }

  const finalStatus: string = run.status === 'awaiting_approval' ? 'awaiting_approval' : 'completed';
  db.prepare('UPDATE workflows SET status = ? WHERE id = ?').run(finalStatus, workflowId);
  db.prepare(
    "INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp) VALUES ('workflow', ?, 'resume', 'system', ?, datetime('now'))",
  ).run(workflowId, JSON.stringify({ status: finalStatus, steps: run.steps, runId: run.runId }));

  logger.info('Workflow resumed after approval', { workflowId, nodes: run.steps.length, status: finalStatus });
}

// ── Routes ──

workflowsRouter.get('/', (c) => {
  const { db } = getServerContext();
  const projectId = c.req.query('projectId') ?? 'default';
  const rows = db
    .prepare('SELECT * FROM workflows WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId) as any[];
  const workflows = rows.map((r: any) => ({
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
  const { db } = getServerContext();
  const body = await c.req.json();
  const id = `wf_${Date.now()}`;
  const definition = body.definition ?? { nodes: body.nodes ?? [], edges: body.edges ?? [] };
  try {
    db.prepare(
      'INSERT INTO workflows (id, project_id, name, definition, status) VALUES (?, ?, ?, ?, ?)',
    ).run(id, body.projectId ?? 'proj-1', body.name ?? 'Untitled', JSON.stringify(definition), 'draft');
    return c.json({ id, status: 'created' });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

workflowsRouter.put('/:id', async (c) => {
  const { db } = getServerContext();
  const id = c.req.param('id');
  const body = await c.req.json();
  db.prepare('UPDATE workflows SET name = ?, definition = ? WHERE id = ?').run(
    body.name ?? 'Untitled',
    JSON.stringify(body.definition ?? {}),
    id,
  );
  return c.json({ id, status: 'updated' });
});

workflowsRouter.post('/:id/run', async (c) => {
  const { db, logger } = getServerContext();
  const id = c.req.param('id');

  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as any;
  if (!wf) return c.json({ error: 'Workflow not found' }, 404);

  const def = JSON.parse(wf.definition ?? '{}');
  const { nodes, edges } = normalizeDefinition(def);

  if (nodes.length === 0) {
    return c.json({ error: 'Workflow has no nodes' }, 400);
  }

  db.prepare('UPDATE workflows SET status = ? WHERE id = ?').run('running', id);

  const eng = getEngine();
  const entryNodeId = findEntryNode(nodes);

  try {
    const run = await eng.startRun(id, nodes, edges, entryNodeId);

    const finalStatus = run.status;
    db.prepare('UPDATE workflows SET status = ? WHERE id = ?').run(finalStatus, id);
    db.prepare(
      "INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp) VALUES ('workflow', ?, 'run', 'system', ?, datetime('now'))",
    ).run(id, JSON.stringify({ status: finalStatus, steps: run.steps, runId: run.runId }));

    // Collect handoff docs from segment boundaries
    const handoffs: Record<string, unknown> = {};
    for (const [key, value] of run.results) {
      if (key.startsWith('_handoff:')) {
        handoffs[key.replace('_handoff:', '')] = value;
      }
    }

    logger.info('Workflow executed', { id, nodes: run.steps.length, status: finalStatus, segments: Object.keys(handoffs).length });
    return c.json({
      runId: run.runId,
      workflowId: id,
      status: finalStatus,
      steps: run.steps,
      handoffs: Object.keys(handoffs).length > 0 ? handoffs : undefined,
    });
  } catch (e) {
    db.prepare('UPDATE workflows SET status = ? WHERE id = ?').run('failed', id);
    return c.json({ error: (e as Error).message }, 500);
  }
});

workflowsRouter.delete('/:id', (c) => {
  const { db, logger } = getServerContext();
  const id = c.req.param('id');
  db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
  logger.info('Workflow deleted', { id });
  return c.json({ status: 'deleted' });
});

workflowsRouter.get('/:id/runs', (c) => {
  const { db } = getServerContext();
  const id = c.req.param('id');
  const rows = db
    .prepare(
      "SELECT * FROM audit_log WHERE entity_type = 'workflow' AND entity_id = ? ORDER BY timestamp DESC LIMIT 20",
    )
    .all(id) as any[];
  const runs = rows.map((r: any) => ({
    runId: r.event_id ?? r.id,
    workflowId: id,
    status: JSON.parse(r.changes ?? '{}').status ?? 'completed',
    steps: JSON.parse(r.changes ?? '{}').steps ?? [],
    timestamp: r.timestamp,
  }));
  return c.json({ runs, total: runs.length });
});
