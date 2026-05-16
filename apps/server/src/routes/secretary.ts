import { Hono } from 'hono';
import { z } from 'zod';
import { getServerContext, type ServerContext } from '../context.js';
import { AgentLoop, AgentDispatcher, ToolExecutor, SafetyChecker, CheckpointManager, registerCabinetTools, AgentRoleRegistry } from '@cabinet/agent';
import type { ToolDependencies, AgentRoleType } from '@cabinet/agent';
import { SecretaryAgent, IntentParser } from '@cabinet/secretary';
import { ParallelReasoning, CrossValidator, type Advisor } from '@cabinet/meeting';
import { broadcast } from '../ws/handler.js';
import type { DispatchMode } from '@cabinet/agent';
import type { Decision } from '@cabinet/types';

export const secretaryRouter = new Hono();

// ── Meeting Advisors (shared with meetings route) ──
const ADVISORS: Advisor[] = [
  { id: 'financial', name: 'Financial Advisor', role: 'Finance', model: 'claude-haiku-4-5', perspective: 'Analyze financial implications, costs, ROI, and budget impact.' },
  { id: 'market', name: 'Market Analyst', role: 'Strategy', model: 'claude-haiku-4-5', perspective: 'Analyze market trends, competitive landscape, and strategic positioning.' },
  { id: 'legal', name: 'Legal Advisor', role: 'Compliance', model: 'claude-haiku-4-5', perspective: 'Identify legal risks, compliance requirements, and regulatory concerns.' },
  { id: 'captain', name: 'Captain', role: 'Decision', model: 'claude-haiku-4-5', perspective: 'Weigh all perspectives and recommend a final decision with actionable next steps.' },
];

// ── Build ToolDependencies from ServerContext ──
function buildToolDependencies(ctx: ServerContext): ToolDependencies {
  return {
    // ── Read path ──
    decisionStore: ctx.decisionRepo,
    eventBus: ctx.eventBus,
    shortTerm: ctx.shortTerm,
    longTerm: ctx.longTerm,
    entity: ctx.entity,
    project: ctx.project,

    // ── Decision write callbacks ──
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
      }) as Decision;
    },
    approveDecision(decisionId, captainId, chosenOptionId) {
      return ctx.decisionService.approve(decisionId, captainId, chosenOptionId);
    },
    rejectDecision(decisionId, captainId) {
      return ctx.decisionService.reject(decisionId, captainId);
    },

    // ── Workflow write callbacks ──
    createWorkflow(input) {
      const id = `wf_${Date.now()}`;
      ctx.db.prepare(
        'INSERT INTO workflows (id, project_id, name, definition, status) VALUES (?, ?, ?, ?, ?)'
      ).run(id, input.projectId, input.name, JSON.stringify(input.definition ?? {}), 'draft');
      ctx.logger.info('Workflow created via tool', { id, name: input.name });
      return { id };
    },
    updateWorkflow(id, input) {
      if (input.name !== undefined || input.definition !== undefined) {
        const name = input.name;
        const definition = input.definition;
        if (name !== undefined && definition !== undefined) {
          ctx.db.prepare('UPDATE workflows SET name = ?, definition = ? WHERE id = ?')
            .run(name, JSON.stringify(definition), id);
        } else if (name !== undefined) {
          ctx.db.prepare('UPDATE workflows SET name = ? WHERE id = ?').run(name, id);
        } else if (definition !== undefined) {
          ctx.db.prepare('UPDATE workflows SET definition = ? WHERE id = ?')
            .run(JSON.stringify(definition), id);
        }
      }
    },
    deleteWorkflow(id) {
      ctx.db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
      ctx.logger.info('Workflow deleted via tool', { id });
    },
    async runWorkflow(id) {
      return executeWorkflowById(id, ctx);
    },

    // ── Meeting write callback ──
    async startMeeting(topic, advisorIds) {
      return runMeeting(topic, advisorIds, ctx);
    },

    // ── Memory write callbacks ──
    async writeLongTermMemory(content, metadata) {
      return ctx.longTerm.store({
        content,
        metadata: metadata ?? {},
        timestamp: new Date(),
      });
    },

    // ── Employee write callback ──
    createEmployee(input) {
      const id = `emp_${Date.now()}`;
      ctx.db.prepare(
        'INSERT INTO employees (id, project_id, name, role, kind, persona, permission_level) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, 'default', input.name, input.role, input.kind, '{}', 'read');
      ctx.logger.info('Employee created via tool', { id, name: input.name });
    },

    // ── Agent registry callbacks ──
    registerAgent(input) {
      const role = {
        type: 'custom' as const,
        name: input.name,
        description: input.description,
        systemPrompt: input.systemPrompt,
        model: input.model,
        temperature: input.temperature,
        maxResponseTokens: input.maxResponseTokens,
        allowedTools: input.allowedTools,
        contextBudget: input.contextBudget,
      };
      ctx.agentRegistry.register(role);
      ctx.logger.info('Agent registered via tool', { name: input.name });
      return { type: 'custom', name: input.name };
    },
    listAgents() {
      return ctx.agentRegistry.list().map(r => ({
        type: r.type,
        name: r.name,
        description: r.description,
        builtIn: r.type !== 'custom',
      }));
    },
  };
}

// ── Workflow execution helper ──
async function executeWorkflowById(
  workflowId: string,
  ctx: ServerContext,
): Promise<{ runId: string; status: string; steps?: unknown[] }> {
  const wf = ctx.db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId) as any;
  if (!wf) throw new Error(`Workflow not found: ${workflowId}`);

  const def = JSON.parse(wf.definition ?? '{}');
  const nodes: { id: string; type: string; data: any }[] = def.nodes ?? [];
  const edges: { source: string; target: string }[] = def.edges ?? [];
  const runId = `run_${Date.now()}`;

  if (nodes.length === 0) throw new Error('Workflow has no nodes');

  ctx.db.prepare('UPDATE workflows SET status = ? WHERE id = ?').run('running', workflowId);

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const graph = new Map<string, string[]>();
  for (const n of nodes) graph.set(n.id, []);
  for (const e of edges) {
    if (!graph.has(e.source)) graph.set(e.source, []);
    graph.get(e.source)!.push(e.target);
  }

  const results: { nodeId: string; type: string; output: string }[] = [];
  const visited = new Set<string>();

  async function executeNode(nodeId: string): Promise<void> {
    if (visited.has(nodeId)) return;
    const node = nodeMap.get(nodeId);
    if (!node) return;
    visited.add(nodeId);

    const d = node.data ?? {};
    let output = '';

    switch (node.type) {
      case 'start':
        output = 'Workflow started';
        break;
      case 'end':
        output = 'Workflow ended';
        break;
      case 'aiAgent':
      case 'llmCall':
        if (!ctx.gateway) { output = 'No LLM available'; break; }
        try {
          const response = await ctx.gateway.generateText({
            model: d.model ?? 'claude-haiku-4-5',
            messages: [{ role: 'user', content: d.prompt ?? d.label ?? 'Process this step' }],
            maxTokens: 200,
          });
          output = response.content;
          ctx.metrics.increment('llm_call', { model: d.model ?? 'claude-haiku-4-5', purpose: 'workflow_tool' });
        } catch (e: any) { output = `Error: ${e.message}`; }
        break;
      case 'humanApproval':
        output = `Approval pending: ${d.label ?? nodeId}`;
        ctx.db.prepare("UPDATE workflows SET status = ? WHERE id = ?").run('awaiting_approval', workflowId);
        broadcast('workflow_approval_needed', { workflowId, runId, nodeId, label: d.label });
        break;
      case 'condition': {
        const prevOutputs = results.map(r => r.output.toLowerCase()).join(' ');
        const isTrue = prevOutputs.includes('approved') || prevOutputs.includes('true');
        const children = graph.get(nodeId) ?? [];
        if (children.length >= 2) {
          const targetIdx = isTrue ? 0 : Math.min(1, children.length - 1);
          const targetNode = children[targetIdx];
          if (targetNode) await executeNode(targetNode);
        } else {
          for (const child of children) await executeNode(child);
        }
        results.push({ nodeId, type: 'condition', output: `Condition: ${isTrue}` });
        return;
      }
      case 'dataQuery':
        output = 'Data query executed';
        break;
      case 'notification':
        output = d.message ?? 'Notification sent';
        broadcast('workflow_notification', { workflowId, runId, nodeId, message: output });
        break;
      case 'wait':
        output = `Waited ${d.duration ?? '5s'}`;
        break;
      default:
        output = 'Unknown node type';
    }

    results.push({ nodeId, type: node.type ?? 'unknown', output });

    const children = graph.get(nodeId) ?? [];
    for (const child of children) await executeNode(child);
  }

  const startNodes = nodes.filter(n => n.type === 'start');
  try {
    if (startNodes.length > 0 && startNodes[0]) {
      await executeNode(startNodes[0].id);
    } else {
      for (const n of nodes) await executeNode(n.id);
    }

    const finalStatus = results.some(r => r.type === 'humanApproval' && r.output.includes('pending'))
      ? 'awaiting_approval' : 'completed';
    ctx.db.prepare('UPDATE workflows SET status = ? WHERE id = ?').run(finalStatus, workflowId);
    ctx.db.prepare(
      "INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp) VALUES ('workflow', ?, 'run', 'system', ?, datetime('now'))"
    ).run(workflowId, JSON.stringify({ status: finalStatus, steps: results, runId }));
    ctx.logger.info('Workflow executed via tool', { workflowId, nodes: results.length, status: finalStatus });
    return { runId, status: finalStatus, steps: results };
  } catch (e) {
    ctx.db.prepare('UPDATE workflows SET status = ? WHERE id = ?').run('failed', workflowId);
    throw e;
  }
}

// ── Meeting execution helper ──
async function runMeeting(
  topic: string,
  advisorIds: string[] | undefined,
  ctx: ServerContext,
): Promise<{ meetingId: string; topic: string; synthesis: string; perspectives: unknown[]; crossValidation?: unknown; decisionId?: string | null }> {
  const meetingId = `meeting_${Date.now()}`;
  const selected = advisorIds ?? ADVISORS.map(a => a.id);
  const advisors = ADVISORS.filter(a => selected.includes(a.id));

  if (!ctx.gateway) {
    const synthesis = `[No LLM] Meeting on "${topic}" created. Configure API keys for AI-powered meetings.`;
    ctx.db.prepare(
      "INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp) VALUES ('meeting', ?, 'create', 'system', ?, datetime('now'))"
    ).run(meetingId, JSON.stringify({ topic, status: 'started', synthesis }));
    return { meetingId, topic, synthesis, perspectives: [] };
  }

  // Phase 1: Parallel reasoning (using dedicated module)
  const reasoning = new ParallelReasoning(ctx.gateway);
  const reasonings = await reasoning.reason(advisors, topic);
  for (const _ of reasonings) {
    ctx.metrics.increment('llm_call', { model: 'claude-haiku-4-5', purpose: 'meeting_tool' });
  }

  const perspectives = reasonings.map(r => ({
    advisor: r.advisor.name,
    role: r.advisor.role,
    content: r.content,
  }));

  // Phase 2: Cross-validation (detect contradictions and gaps)
  let crossValidation = null;
  try {
    const validator = new CrossValidator(ctx.gateway);
    crossValidation = await validator.validate(topic, reasonings);
    ctx.metrics.increment('llm_call', { model: 'claude-haiku-4-5', purpose: 'meeting_cross_validate' });
  } catch {
    // Cross-validation failure is non-fatal
  }

  // Phase 3: Chair synthesis (aware of cross-validation results)
  let synthesis = '';
  try {
    const summary = perspectives.map(p => `[${p.advisor} (${p.role})]: ${p.content}`).join('\n\n');
    let validationNote = '';
    if (crossValidation) {
      const v = crossValidation as any;
      validationNote = [
        v.disagreements?.length ? `\nKey disagreements:\n${v.disagreements.map((d: string) => `- ${d}`).join('\n')}` : '',
        v.gaps?.length ? `\nUnaddressed angles:\n${v.gaps.map((g: string) => `- ${g}`).join('\n')}` : '',
      ].filter(Boolean).join('\n');
    }

    const chairPrompt = [
      `You are the Chair. Review advisor perspectives on "${topic}" and provide:`,
      '1. A 2-3 sentence synthesis combining the best insights',
      '2. Key risks identified',
      '3. Recommended next step',
      validationNote ? `\nAdditional analysis:\n${validationNote}` : '',
      `\nAdvisor perspectives:\n${summary}`,
    ].join('\n');

    const chairResponse = await ctx.gateway.generateText({
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: chairPrompt }],
      maxTokens: 400,
    });
    synthesis = chairResponse.content;
    ctx.metrics.increment('llm_call', { model: 'claude-haiku-4-5', purpose: 'meeting_tool_chair' });
  } catch {
    synthesis = 'Synthesis unavailable.';
  }

  // Persist
  ctx.db.prepare(
    "INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp) VALUES ('meeting', ?, 'create', 'system', ?, datetime('now'))"
  ).run(meetingId, JSON.stringify({ topic, status: 'completed', synthesis, perspectives, crossValidation }));
  broadcast('meeting_created', { meetingId, topic, attendees: perspectives.map((p: any) => p.advisor) });

  // Phase 4: Auto-extract decision if meeting produced actionable options
  let decisionId: string | null = null;
  if (ctx.gateway && synthesis && synthesis.length > 20) {
    try {
      const summary = perspectives.map(p => `[${p.advisor}]: ${p.content}`).join('\n');
      const extractionPrompt = [
        `Analyze this meeting outcome and determine if it contains a decision the Captain should make.`,
        '',
        `Topic: ${topic}`,
        '',
        `Synthesis: ${synthesis}`,
        '',
        `Advisor views:`,
        summary,
        '',
        `Respond with ONLY a JSON object. If there IS an actionable decision, return:`,
        `{"hasDecision": true, "title": "short decision title", "description": "1-2 sentence summary", "options": [{"label": "Option A", "impact": "what happens if chosen"}], "level": "L1"}`,
        '',
        `If there is NO actionable decision (just information sharing, status updates, etc.), return:`,
        `{"hasDecision": false}`,
        '',
        `Only flag as a decision if there are genuinely different options the Captain needs to choose between.`,
      ].join('\n');

      const extractionResponse = await ctx.gateway.generateText({
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: extractionPrompt }],
        maxTokens: 400,
        temperature: 0.1,
      });

      const match = extractionResponse.content.match(/\{[\s\S]*\}/);
      if (match) {
        const extracted = JSON.parse(match[0]);
        if (extracted.hasDecision && extracted.title) {
          const decId = `dec_${Date.now()}`;
          const options = (extracted.options ?? [
            { label: 'Approve', impact: 'Proceed as recommended' },
            { label: 'Reject', impact: 'Do not proceed' },
          ]).map((o: any, i: number) => ({
            id: `opt_${i}`, label: o.label, impact: o.impact ?? '',
          }));

          ctx.decisionService.create({
            id: decId,
            projectId: 'default',
            type: 'strategic',
            title: extracted.title,
            description: extracted.description ?? `Decision extracted from meeting: ${topic}`,
            options,
            classification: {
              scopeDescription: topic,
              isCrossSession: false,
              optionCount: options.length,
              estimatedCostUsd: 0,
              involvesFunds: false,
              involvesPermissions: false,
              involvesDataDeletion: false,
              involvesOrgConfig: false,
            },
          });
          decisionId = decId;
          broadcast('decision_created', { decisionId: decId, title: extracted.title, level: extracted.level ?? 'L1' });
          ctx.logger.info('Decision auto-extracted from meeting', { meetingId, decisionId: decId });
        }
      }
    } catch (e: any) {
      ctx.logger.warn('Meeting decision extraction failed', { error: e.message, meetingId });
    }
  }

  return { meetingId, topic, synthesis, perspectives, crossValidation, decisionId };
}

// ── Multi-agent cache ──
const agentLoopCache = new Map<AgentRoleType, AgentLoop>();
let secretaryAgentCache: SecretaryAgent | null = null;
let lastGatewayCheck = false;

function buildMemoryProvider(ctx: ServerContext) {
  return {
    async getShortTerm(sid: string) {
      const all = ctx.shortTerm.getAll(sid);
      return Object.entries(all).map(([k, v]) => ({
        role: 'user' as const,
        content: `[${k}]: ${JSON.stringify(v)}`,
      }));
    },
    async getProjectContext(_pid: string) {
      const projCtx = ctx.project.get(_pid);
      if (!projCtx) return `Cabinet v2.0 project. ${_pid}`;
      return `Project: ${projCtx.summary}\nGoals: ${projCtx.goals.join(', ')}\nMilestones: ${projCtx.milestones.map(m => `${(m as any).name ?? (m as any).title ?? 'milestone'} (${(m as any).status ?? 'pending'})`).join(', ')}`;
    },
    async getEntityPreferences(_captainId: string) {
      const prefs = ctx.entity.getPreferences(_captainId);
      return prefs?.preferences ?? {};
    },
    async searchLongTerm(query: string, _pid: string) {
      const results = await ctx.longTerm.search(query, 5);
      return results.map(r => `[Memory] ${r.content}`);
    },
  };
}

/** Get or create an AgentLoop for a specific role. */
function getAgentLoopForRole(
  roleType: AgentRoleType,
  sessionId: string,
  projectId: string,
  captainId: string,
): AgentLoop | null {
  const ctx = getServerContext();
  if (!ctx.gateway) return null;

  // Return cached if available (role + session is unique enough; cache by role type only)
  const cached = agentLoopCache.get(roleType);
  if (cached) return cached;

  const registry = getServerContext().agentRegistry;
  const role = registry.get(roleType);
  if (!role) return null;

  const executor = new ToolExecutor();
  registerCabinetTools(executor, buildToolDependencies(ctx));

  // Apply role's tool restrictions
  if (role.allowedTools.length > 0) {
    const allTools = executor.listTools();
    for (const toolName of allTools) {
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
    memoryProvider: buildMemoryProvider(ctx),
    sessionId: `${sessionId}-${role.type}`,
    projectId,
    captainId,
    systemPrompt: role.systemPrompt,
    model: role.model,
    maxSteps: 10,
  });

  agentLoopCache.set(roleType, loop);
  return loop;
}

/** Dispatch a message to a specialist role's AgentLoop. */
async function dispatchToSpecialist(
  roleType: AgentRoleType,
  message: string,
  sessionId: string,
  projectId: string,
  captainId: string,
): Promise<string> {
  const loop = getAgentLoopForRole(roleType, sessionId, projectId, captainId);
  if (!loop) return `[No LLM] Cannot dispatch to ${roleType}.`;

  const result = await loop.run(message);
  return result.content;
}

function getOrCreateAgent(sessionId: string, projectId: string, captainId: string, model?: string) {
  const ctx = getServerContext();
  const hasGateway = ctx.gateway !== null;

  // Reset cache if gateway status changed
  if (hasGateway !== lastGatewayCheck) {
    agentLoopCache.clear();
    secretaryAgentCache = null;
    lastGatewayCheck = hasGateway;
  }

  if (secretaryAgentCache) {
    return { agent: secretaryAgentCache };
  }

  // Secretary's own executor (all tools)
  const executor = new ToolExecutor();
  registerCabinetTools(executor, buildToolDependencies(ctx));

  const memoryProvider = buildMemoryProvider(ctx);

  let secretaryLoop: AgentLoop | null = null;
  if (hasGateway) {
    const checkpointManager = new CheckpointManager(ctx.db);
    secretaryLoop = new AgentLoop({
      gateway: ctx.gateway!,
      toolExecutor: executor,
      safetyChecker: new SafetyChecker(ctx.delegationTier),
      checkpointManager,
      memoryProvider,
      sessionId,
      projectId,
      captainId,
      maxSteps: 10,
    });
  }

  const intentParser = new IntentParser(hasGateway ? ctx.gateway! : undefined);

  // Initialize the router with agent descriptions
  const registry = getServerContext().agentRegistry;
  intentParser.setAgentDescriptions(registry.describeForRouting());

  secretaryAgentCache = new SecretaryAgent(
    secretaryLoop ?? (null as any),
    intentParser,
    ctx.sessionManager,
    ctx.gateway ?? undefined,
    // dispatchToRole callback: routes to specialist agents
    async (roleType, msg, sid) => {
      return dispatchToSpecialist(roleType, msg, sid, projectId, captainId);
    },
  );

  return { agent: secretaryAgentCache };
}

const fileSchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.string().optional(),
}).passthrough();

// ── POST /chat ──
const chatSchema = z.object({
  sessionId: z.string(),
  message: z.string(),
  captainId: z.string().optional(),
  projectId: z.string().optional(),
  model: z.string().optional(),
  files: z.array(fileSchema).optional(),
  stream: z.boolean().optional(),
  dispatchMode: z.enum(['single', 'pipeline', 'parallel']).optional(),
});

secretaryRouter.post('/chat', async (c) => {
  const ctx = getServerContext();
  const body = await c.req.json();
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const { sessionId, message } = parsed.data;
  const captainId = parsed.data.captainId ?? 'captain-1';
  const files = parsed.data.files ?? [];
  const projectId = parsed.data.projectId ?? 'default';
  const model = parsed.data.model;
  const stream = parsed.data.stream ?? false;
  const dispatchMode: DispatchMode = parsed.data.dispatchMode ?? 'single';

  if (!ctx.sessionManager.get(sessionId)) {
    ctx.sessionManager.create(sessionId, `Session ${sessionId.slice(0, 8)}`);
  }

  try {
    const { agent } = getOrCreateAgent(sessionId, projectId, captainId, model);

    // Augment message with attached file contents (shared by all modes)
    let augmentedMessage = message;
    if (files.length > 0) {
      const fileLines: string[] = [];
      for (const f of files) {
        fileLines.push(`- ${f.name} (${f.path})`);
        if (f.type === 'project') {
          try {
            const { readFile } = await import('node:fs/promises');
            const { join } = await import('node:path');
            const root = join(process.cwd(), '..', '..', '..');
            const fullPath = join(root, f.path);
            if (fullPath.startsWith(root)) {
              const content = await readFile(fullPath, 'utf-8');
              fileLines.push(`\n--- ${f.path} ---\n${content.slice(0, 8000)}\n`);
            }
          } catch { /* file not readable, skip content */ }
        }
      }
      augmentedMessage = `${message}\n\n[Attached files]\n${fileLines.join('\n')}`;
    }

    if (ctx.gateway) {
      // ── Dispatch mode: pipeline or parallel ──
      if (dispatchMode === 'pipeline' || dispatchMode === 'parallel') {
        const executor = new ToolExecutor();
        registerCabinetTools(executor, buildToolDependencies(ctx));

        const dispatcher = new AgentDispatcher(
          ctx.gateway,
          executor,
          ctx.db,
          {
            async getShortTerm(sid: string) {
              const all = ctx.shortTerm.getAll(sid);
              return Object.entries(all).map(([k, v]) => ({
                role: 'user' as const,
                content: `[${k}]: ${JSON.stringify(v)}`,
              }));
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
              const results = await ctx.longTerm.search(query, 5);
              return results.map(r => `[Memory] ${r.content}`);
            },
          },
          ctx.eventBus,
        );

        const result = await dispatcher.dispatch({
          mode: dispatchMode,
          request: augmentedMessage,
          sessionId,
          projectId,
          captainId,
        });

        ctx.metrics.increment('llm_call', { model: model ?? 'claude-sonnet-4-6', purpose: dispatchMode });
        broadcast('secretary_message', { sessionId, projectId, captainId, mode: dispatchMode });

        return c.json({
          sessionId, projectId, captainId,
          response: result.finalOutput,
          dispatchMode,
          steps: result.steps.map(s => ({
            role: s.role,
            status: s.status,
            durationMs: s.durationMs,
            agentSteps: s.steps,
          })),
          totalSteps: result.totalSteps,
          totalDurationMs: result.totalDurationMs,
        });
      }

      // ── Single mode (default) ──
      const result = await agent.handleMessage(sessionId, augmentedMessage);

      // Record cost if available
      if ((result as any).usage) {
        ctx.costTracker.record(
          model ?? 'claude-sonnet-4-6',
          (result as any).usage.promptTokens ?? 0,
          (result as any).usage.completionTokens ?? 0,
        );
      }
      ctx.metrics.increment('llm_call', { model: model ?? 'claude-sonnet-4-6', purpose: 'chat' });

      broadcast('secretary_message', { sessionId, projectId, captainId, mode: 'single' });
      return c.json({
        sessionId, projectId, captainId,
        response: result.response,
        intent: result.intent,
        route: result.routeResult ? {
          targetAgent: result.routeResult.targetAgent,
          confidence: result.routeResult.confidence,
          reasoning: result.routeResult.reasoning,
          suggestion: result.routeResult.suggestion,
        } : undefined,
        mode: 'single',
        dispatchMode: 'single',
        model: model ?? 'claude-sonnet-4-6',
        toolCalls: (result as any).toolCalls ?? 0,
      });
    } else {
      const parser = new IntentParser();
      const intent = parser.parse(message);
      ctx.sessionManager.addMessage(sessionId, 'user', message);
      const response = `[No API key] Intent: ${intent.kind}. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env for LLM mode.`;
      ctx.sessionManager.addMessage(sessionId, 'assistant', response);
      broadcast('secretary_message', { sessionId, projectId, captainId, mode: 'fallback' });
      return c.json({ sessionId, projectId, captainId, response, intent, mode: 'fallback', model: 'none' });
    }
  } catch (error) {
    const msg = (error as Error).message;
    ctx.logger.error('Secretary agent error', { error: msg });
    const isAuthError = msg.includes('API key') || msg.includes('not configured') || msg.includes('401');
    return c.json({
      sessionId, projectId, captainId,
      response: `Error: ${msg}`, intent: { kind: 'unknown' }, mode: 'error',
    }, isAuthError ? 503 : 500);
  }
});

// ── GET /verify ──
secretaryRouter.get('/verify', async (c) => {
  const { gateway, costTracker, metrics } = getServerContext();
  if (!gateway) {
    return c.json({ status: 'no_api_key', message: 'Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env to enable LLM.' });
  }
  try {
    const start = Date.now();
    const response = await gateway.generateText({
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'Reply with just "OK".' }],
      maxTokens: 10,
    });
    costTracker.record('claude-haiku-4-5', response.usage?.promptTokens ?? 0, response.usage?.completionTokens ?? 0);
    metrics.increment('llm_call', { model: 'claude-haiku-4-5', purpose: 'verify' });
    const latency = Date.now() - start;
    return c.json({ status: 'ok', latency_ms: latency, model: response.model, tokens: response.usage });
  } catch (error) {
    return c.json({ status: 'error', message: (error as Error).message, hint: 'Check your API key and network connection.' }, 503);
  }
});

// ── GET /sessions ──
secretaryRouter.get('/sessions', (c) => {
  const { sessionManager } = getServerContext();
  const sessions = sessionManager.list();
  return c.json({
    sessions: sessions.map(s => ({
      id: s.id, title: s.title, messageCount: s.messages.length, updatedAt: s.updatedAt,
    })),
  });
});

// ── GET /context ──
secretaryRouter.get('/context', (c) => {
  const { sessionManager, metrics } = getServerContext();
  const sessionId = c.req.query('sessionId') ?? 'default';
  const session = sessionManager.get(sessionId);

  const messageCount = session?.messages.length ?? 0;
  // Rough estimate: ~4 chars per token
  const totalChars = session?.messages.reduce((sum, m) => sum + m.content.length, 0) ?? 0;
  const estimatedTokens = Math.ceil(totalChars / 4);

  return c.json({
    sessionId,
    messageCount,
    estimatedTokens,
    maxContextTokens: 200000,
    summary: metrics.getSummary(),
  });
});
