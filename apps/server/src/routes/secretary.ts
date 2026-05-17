import { Hono } from 'hono';
import { z } from 'zod';
import { getServerContext, type ServerContext } from '../context.js';
import {
  AgentLoop,
  AgentDispatcher,
  ToolExecutor,
  SafetyChecker,
  CheckpointManager,
  registerCabinetTools,
  registerSkillTools,
  registerMCPTools,
  AgentRoleRegistry,
} from '@cabinet/agent';
import type { ToolDependencies, AgentRoleType } from '@cabinet/agent';
import { SecretaryAgent, IntentParser, GreetingService } from '@cabinet/secretary';
import { ParallelReasoning, CrossValidator, type Advisor } from '@cabinet/meeting';
import { broadcast } from '../ws/handler.js';
import type { DispatchMode } from '@cabinet/agent';
import type { Decision } from '@cabinet/types';
import { ANALYSIS_PERSPECTIVES } from '../api-helpers.js';

export const secretaryRouter = new Hono();

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

    // ── Workflow read callbacks ──
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

    // ── Workflow write callbacks ──
    createWorkflow(input) {
      const id = `wf_${Date.now()}`;
      ctx.db
        .prepare(
          'INSERT INTO workflows (id, project_id, name, definition, status) VALUES (?, ?, ?, ?, ?)',
        )
        .run(id, input.projectId, input.name, JSON.stringify(input.definition ?? {}), 'draft');
      ctx.logger.info('Workflow created via tool', { id, name: input.name });
      return { id };
    },
    updateWorkflow(id, input) {
      if (input.name !== undefined || input.definition !== undefined) {
        const name = input.name;
        const definition = input.definition;
        if (name !== undefined && definition !== undefined) {
          ctx.db
            .prepare('UPDATE workflows SET name = ?, definition = ? WHERE id = ?')
            .run(name, JSON.stringify(definition), id);
        } else if (name !== undefined) {
          ctx.db.prepare('UPDATE workflows SET name = ? WHERE id = ?').run(name, id);
        } else if (definition !== undefined) {
          ctx.db
            .prepare('UPDATE workflows SET definition = ? WHERE id = ?')
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
    async startMeeting(topic, advisorIds, projectId) {
      return runMeeting(topic, advisorIds, projectId, ctx);
    },

    // ── Memory write callbacks ──
    async writeLongTermMemory(content, metadata) {
      // Auto-generate embedding for semantic search
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

    // ── Employee write callback ──
    createEmployee(input) {
      const id = `emp_${Date.now()}`;
      ctx.db
        .prepare(
          'INSERT INTO employees (id, project_id, name, role, kind, persona, permission_level) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, 'default', input.name, input.role, input.kind, '{}', 'read');
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
      // Persist to DB
      try {
        ctx.db.prepare(
          `INSERT OR REPLACE INTO agent_roles (type, name, description, system_prompt, model, temperature, max_response_tokens, allowed_tools, context_budget, is_builtin)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        ).run(
          'custom',
          input.name,
          input.description,
          input.systemPrompt,
          input.model,
          input.temperature,
          input.maxResponseTokens,
          JSON.stringify(input.allowedTools),
          input.contextBudget,
        );
      } catch (e) {
        ctx.logger.warn('Failed to persist custom agent', { name: input.name, error: String(e) });
      }
      // Update IntentParser's valid agent types
      const newValidTypes = ctx.agentRegistry.getValidAgentTypes();
      // Will be picked up by next request since parser is cached per session
      ctx.logger.info('Agent registered via tool', { name: input.name });
      return { type: 'custom', name: input.name };
    },
    updateAgent(name, updates) {
      const existing = ctx.agentRegistry.get(name);
      if (existing && existing.type === 'custom') {
        ctx.agentRegistry.update(name, updates as any);
        // Update DB
        const setClauses: string[] = [];
        const params: any[] = [];
        for (const [k, v] of Object.entries(updates)) {
          const col = k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
          setClauses.push(`${col} = ?`);
          params.push(k === 'allowedTools' ? JSON.stringify(v) : v);
        }
        if (setClauses.length > 0) {
          params.push(name);
          ctx.db.prepare(`UPDATE agent_roles SET ${setClauses.join(', ')} WHERE name = ?`).run(...params);
        }
      }
    },
    deleteAgent(name) {
      ctx.agentRegistry.unregister(name);
      ctx.db.prepare('DELETE FROM agent_roles WHERE name = ?').run(name);
    },
    listAgents() {
      return ctx.agentRegistry.list().map((r) => ({
        type: r.type,
        name: r.name,
        description: r.description,
        builtIn: r.type !== 'custom',
      }));
    },

    // ── Project tools ──
    setProjectContext(projectId) {
      const row = ctx.db.prepare('SELECT id, name FROM projects WHERE id = ?').get(projectId) as any;
      if (!row) throw new Error(`Project not found: ${projectId}`);
      return { id: row.id, name: row.name };
    },
    createProject(input) {
      const id = `proj_${Date.now()}`;
      ctx.db
        .prepare('INSERT INTO projects (id, name, description, root_path, last_activity_at) VALUES (?, ?, ?, ?, datetime(\'now\'))')
        .run(id, input.name, input.description ?? '', input.rootPath ?? '');
      ctx.db.prepare('INSERT INTO project_context (project_id, summary) VALUES (?, ?)').run(id, '');
      ctx.logger.info('Project created via tool', { id, name: input.name });
      return { id, name: input.name };
    },
    listProjects() {
      const rows = ctx.db
        .prepare('SELECT id, name, last_activity_at FROM projects WHERE archived = 0 ORDER BY last_activity_at DESC')
        .all() as any[];
      return rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        lastActivityAt: r.last_activity_at,
        activeWorkflowCount: 0,
      }));
    },
    getProjectContext(projectId) {
      const project = ctx.db.prepare('SELECT id, name, description FROM projects WHERE id = ?').get(projectId) as any;
      if (!project) return null;
      const pctx = ctx.db.prepare('SELECT * FROM project_context WHERE project_id = ?').get(projectId) as any;
      const decisions = ctx.db
        .prepare("SELECT id, title, status FROM decisions WHERE project_id = ? ORDER BY created_at DESC LIMIT 5")
        .all(projectId) as any[];
      return {
        id: project.id,
        name: project.name,
        description: project.description,
        summary: pctx?.summary ?? '',
        goals: JSON.parse(pctx?.goals ?? '[]'),
        constraints: JSON.parse(pctx?.constraints ?? '{}'),
        recentDecisions: decisions,
      };
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

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
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
        if (!ctx.gateway) {
          output = 'No LLM available';
          break;
        }
        try {
          const response = await ctx.gateway.generateText({
            model: d.model ?? 'claude-haiku-4-5',
            messages: [{ role: 'user', content: d.prompt ?? d.label ?? 'Process this step' }],
            maxTokens: 200,
          });
          output = response.content;
          ctx.metrics.increment('llm_call', {
            model: d.model ?? 'claude-haiku-4-5',
            purpose: 'workflow_tool',
          });
        } catch (e: any) {
          output = `Error: ${e.message}`;
        }
        break;
      case 'humanApproval':
        output = `Approval pending: ${d.label ?? nodeId}`;
        ctx.db
          .prepare('UPDATE workflows SET status = ? WHERE id = ?')
          .run('awaiting_approval', workflowId);
        broadcast('workflow_approval_needed', { workflowId, runId, nodeId, label: d.label });
        break;
      case 'condition': {
        const prevOutputs = results.map((r) => r.output.toLowerCase()).join(' ');
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

  const startNodes = nodes.filter((n) => n.type === 'start');
  try {
    if (startNodes.length > 0 && startNodes[0]) {
      await executeNode(startNodes[0].id);
    } else {
      for (const n of nodes) await executeNode(n.id);
    }

    const finalStatus = results.some(
      (r) => r.type === 'humanApproval' && r.output.includes('pending'),
    )
      ? 'awaiting_approval'
      : 'completed';
    ctx.db.prepare('UPDATE workflows SET status = ? WHERE id = ?').run(finalStatus, workflowId);
    ctx.db
      .prepare(
        "INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp) VALUES ('workflow', ?, 'run', 'system', ?, datetime('now'))",
      )
      .run(workflowId, JSON.stringify({ status: finalStatus, steps: results, runId }));
    ctx.logger.info('Workflow executed via tool', {
      workflowId,
      nodes: results.length,
      status: finalStatus,
    });
    return { runId, status: finalStatus, steps: results };
  } catch (e) {
    ctx.db.prepare('UPDATE workflows SET status = ? WHERE id = ?').run('failed', workflowId);
    throw e;
  }
}

// ── Meeting result capture (module-level, read by /chat handler) ──
let capturedMeetingResult: MeetingResult | null = null;

interface MeetingResult {
  meetingId: string;
  topic: string;
  synthesis: string;
  perspectives: unknown[];
  crossValidation?: unknown;
  decisionId?: string | null;
}

// ── Meeting execution helper ──
async function runMeeting(
  topic: string,
  advisorIds: string[] | undefined,
  projectId: string | undefined,
  ctx: ServerContext,
): Promise<{
  meetingId: string;
  topic: string;
  synthesis: string;
  perspectives: unknown[];
  decisionId?: string | null;
}> {
  const meetingId = `meeting_${Date.now()}`;
  const selected = advisorIds ?? ANALYSIS_PERSPECTIVES.map((p) => p.id);
  const advisors = ANALYSIS_PERSPECTIVES
    .filter((p) => selected.includes(p.id))
    .map((p) => ({ id: p.id, name: p.name, role: p.framework, model: 'claude-haiku-4-5', perspective: p.framework }));

  if (!ctx.gateway) {
    const synthesis = `[No LLM] Meeting on "${topic}" created. Configure API keys for AI-powered meetings.`;
    ctx.db
      .prepare(
        "INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp) VALUES ('meeting', ?, 'create', 'system', ?, datetime('now'))",
      )
      .run(meetingId, JSON.stringify({ topic, status: 'started', synthesis }));
    return { meetingId, topic, synthesis, perspectives: [] };
  }

  const model = 'claude-haiku-4-5';

  // Phase 1: MeetingChair constructs analysis Brief (1 LLM call — coordination)
  let analysisBrief: string;
  try {
    const perspectiveList = advisors
      .map((a) => `- ${a.name}: ${a.perspective}`)
      .join('\n');
    const chairPrompt = [
      `You are the Meeting Chair. Your job is to coordinate analysis, not perform it.`,
      `Construct a structured analysis Brief for the Advisor.`,
      '',
      `Topic: "${topic}"`,
      '',
      `Available perspectives:`,
      perspectiveList,
      '',
      `Your task:`,
      `1. Select the most relevant perspectives for this topic (2-4).`,
      `2. For each selected perspective, specify a FOCUSED analysis angle — not generic "analyze the market" but specific like "assess market entry barriers for this product in the EU."`,
      `3. Include any project context that is relevant.`,
      '',
      `Output as JSON:`,
      `{`,
      `  "selected_perspectives": [`,
      `    {"id": "market", "focus": "specific analysis focus here"},`,
      `    ...`,
      `  ],`,
      `  "topic_refined": "refined topic statement",`,
      `  "key_questions": ["question the analysis must answer"]`,
      `}`,
    ].join('\n');

    const chairResponse = await ctx.gateway!.generateText({
      model,
      messages: [{ role: 'user', content: chairPrompt }],
      maxTokens: 600,
      temperature: 0.3,
    });
    const match = chairResponse.content.match(/\{[\s\S]*\}/);
    analysisBrief = match ? match[0] : JSON.stringify({ selected_perspectives: advisors.map((a) => ({ id: a.id, focus: a.perspective })), topic_refined: topic, key_questions: [] });
    ctx.metrics.increment('llm_call', { model, purpose: 'meeting_chair_brief' });
  } catch {
    analysisBrief = JSON.stringify({ selected_perspectives: advisors.map((a) => ({ id: a.id, focus: a.perspective })), topic_refined: topic, key_questions: [] });
  }

  // Phase 2: Advisor multi-perspective analysis (1 LLM call)
  let perspectives: any[];
  try {
    const brief = JSON.parse(analysisBrief);
    const selectedIds = new Set((brief.selected_perspectives as any[]).map((p: any) => p.id));
    const selectedAdvisors = advisors.filter((a) => selectedIds.has(a.id));
    const perspectiveInstructions = (brief.selected_perspectives as any[])
      .map((p: any) => `- ${p.id}: FOCUS on "${p.focus}"`)
      .join('\n');

    const advisorPrompt = [
      `You are a specialized analyst. Analyze the following topic from MULTIPLE perspectives in a single response.`,
      '',
      `Topic: ${brief.topic_refined}`,
      `Key questions to answer: ${(brief.key_questions as string[]).join('; ')}`,
      '',
      `You must analyze from these perspectives:`,
      perspectiveInstructions,
      '',
      `For each perspective, provide:`,
      `- claim: your analytical conclusion`,
      `- evidence: supporting data or reasoning`,
      `- confidence: 0.0 to 1.0`,
      '',
      `After all perspectives, provide:`,
      `- synthesis: 2-3 sentence overall conclusion`,
      `- risks: key risks identified`,
      `- open_questions: what remains uncertain`,
      '',
      `Output as JSON:`,
      `{`,
      `  "perspectives_applied": ["list"],`,
      `  "findings": [`,
      `    {"perspective": "name", "claim": "...", "evidence": "...", "confidence": 0.8}`,
      `  ],`,
      `  "synthesis": "...",`,
      `  "risks": ["..."],`,
      `  "open_questions": ["..."]`,
      `}`,
    ].join('\n');

    const advisorResponse = await ctx.gateway!.generateText({
      model,
      messages: [{ role: 'user', content: advisorPrompt }],
      maxTokens: 1500,
      temperature: 0.4,
    });
    const advisorMatch = advisorResponse.content.match(/\{[\s\S]*\}/);
    const advisorResult = advisorMatch ? JSON.parse(advisorMatch[0]) : { findings: [], synthesis: advisorResponse.content, risks: [], open_questions: [] };
    perspectives = advisorResult.findings ?? [];
    ctx.metrics.increment('llm_call', { model, purpose: 'meeting_advisor' });
  } catch {
    perspectives = [];
  }

  // Phase 3: Reviewer adversarial review (1 LLM call)
  let synthesis = '';
  let reviewPassed = false;
  let reviewIssues: any[] = [];
  const maxRounds = 2;
  for (let round = 0; round < maxRounds && !reviewPassed; round++) {
    try {
      const findingsSummary = perspectives
        .map((f: any) => `[${f.perspective}] claim: ${f.claim} | evidence: ${f.evidence} | confidence: ${f.confidence}`)
        .join('\n');
      const synthesisText = (perspectives as any).synthesis ?? '';

      const reviewerPrompt = [
        `You are an independent Reviewer. Review this analysis for quality.`,
        `Do NOT perform the analysis yourself — only review what was provided.`,
        '',
        `Topic: ${topic}`,
        '',
        `Analysis findings:`,
        findingsSummary || 'No structured findings',
        '',
        `Synthesis: ${synthesisText}`,
        '',
        `Check for:`,
        `- Logical completeness: are all claims connected and coherent?`,
        `- Risk assessment: are risks identified and evaluated?`,
        `- Missing perspectives: what important angle was not covered?`,
        `- Evidence quality: are claims backed by reasoning or data?`,
        '',
        `Output as JSON:`,
        `{`,
        `  "pass": true/false,`,
        `  "issues": [{"type": "missing_perspective|weak_evidence|logical_gap", "detail": "...", "severity": "high|medium|low"}],`,
        `  "suggestion": {"action": "add_perspective|strengthen_evidence|revise_logic", "detail": "what to fix", "or_assign_independent_agent": false}`,
        `}`,
      ].join('\n');

      const reviewerResponse = await ctx.gateway!.generateText({
        model,
        messages: [{ role: 'user', content: reviewerPrompt }],
        maxTokens: 500,
        temperature: 0.1,
      });
      const reviewMatch = reviewerResponse.content.match(/\{[\s\S]*\}/);
      const review = reviewMatch ? JSON.parse(reviewMatch[0]) : { pass: true, issues: [], suggestion: {} };
      reviewPassed = review.pass === true;
      reviewIssues = review.issues ?? [];
      ctx.metrics.increment('llm_call', { model, purpose: 'meeting_reviewer' });

      // Generate synthesis from the final analysis
      if (reviewPassed || round === maxRounds - 1) {
        synthesis = `## Analysis: ${topic}\n\n`;
        if (synthesisText) synthesis += `**Synthesis:** ${synthesisText}\n\n`;
        if (perspectives.length > 0) {
          synthesis += `### Perspectives\n`;
          for (const f of perspectives) {
            synthesis += `- **${(f as any).perspective}** (confidence: ${(f as any).confidence}): ${(f as any).claim}\n`;
          }
        }
        if (reviewIssues.length > 0) {
          synthesis += `\n### Reviewer Notes\n`;
          for (const i of reviewIssues) {
            synthesis += `- [${(i as any).severity}] ${(i as any).detail}\n`;
          }
        }
      }
    } catch {
      synthesis = 'Analysis completed.';
      reviewPassed = true;
    }
  }

  // Persist
  ctx.db
    .prepare(
      "INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp) VALUES ('meeting', ?, 'create', 'system', ?, datetime('now'))",
    )
    .run(
      meetingId,
      JSON.stringify({ topic, status: 'completed', synthesis, perspectives, reviewPassed, projectId }),
    );
  broadcast('meeting_created', {
    meetingId,
    topic,
    attendees: perspectives.map((p: any) => p.name ?? p.advisor),
  });

  // Phase 4: Auto-extract decision if meeting produced actionable options
  let decisionId: string | null = null;
  if (ctx.gateway && synthesis && synthesis.length > 20) {
    try {
      const summary = perspectives.map((p: any) => `[${p.perspective ?? p.name}]: ${p.claim ?? p.content}`).join('\n');
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
          const options = (
            extracted.options ?? [
              { label: 'Approve', impact: 'Proceed as recommended' },
              { label: 'Reject', impact: 'Do not proceed' },
            ]
          ).map((o: any, i: number) => ({
            id: `opt_${i}`,
            label: o.label,
            impact: o.impact ?? '',
          }));

          ctx.decisionService.create({
            id: decId,
            projectId: projectId ?? 'default',
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
          broadcast('decision_created', {
            decisionId: decId,
            title: extracted.title,
            level: extracted.level ?? 'L1',
          });
          ctx.logger.info('Decision auto-extracted from meeting', { meetingId, decisionId: decId });
        }
      }
    } catch (e: any) {
      ctx.logger.warn('Meeting decision extraction failed', { error: e.message, meetingId });
    }
  }

  const result: MeetingResult = { meetingId, topic, synthesis, perspectives, decisionId };
  capturedMeetingResult = result;
  return result;
}

// ── Multi-agent cache (keyed by sessionId:roleType) ──
const agentLoopCache = new Map<string, AgentLoop>();
const MAX_CACHE_SIZE = 100;
// Per-session secretary agents (keyed by sessionId)
const secretaryAgentCache = new Map<string, SecretaryAgent>();
let lastGatewayCheck = false;

function buildMemoryProvider(ctx: ServerContext) {
  return {
    async getShortTerm(sid: string) {
      const items: { role: 'user' | 'assistant'; content: string }[] = [];

      // Include conversation history from SessionManager (last 20 messages)
      const session = ctx.sessionManager.get(sid);
      if (session && session.messages.length > 0) {
        // Exclude last message if it's a user message (will be re-added by AgentLoop)
        const last = session.messages[session.messages.length - 1]!;
        const end = last.role === 'user' ? session.messages.length - 1 : session.messages.length;
        const start = Math.max(0, end - 20);
        for (let i = start; i < end; i++) {
          const m = session.messages[i]!;
          items.push({ role: m.role, content: m.content });
        }
      }

      // Append short-term KV data as additional context
      const kv = ctx.shortTerm.getAll(sid);
      for (const [k, v] of Object.entries(kv)) {
        if (typeof v === 'string' && v.length > 0) {
          items.push({ role: 'user' as const, content: `[${k}]: ${v}` });
        }
      }

      return items;
    },
    async getProjectContext(_pid: string) {
      const projCtx = ctx.project.get(_pid);
      if (!projCtx) return `Cabinet v2.0 project. ${_pid}`;
      return `Project: ${projCtx.summary}\nGoals: ${projCtx.goals.join(', ')}\nMilestones: ${projCtx.milestones.map((m) => `${(m as any).name ?? (m as any).title ?? 'milestone'} (${(m as any).status ?? 'pending'})`).join(', ')}`;
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

/** Get or create an AgentLoop for a specific role. */
function getAgentLoopForRole(
  roleType: AgentRoleType,
  sessionId: string,
  projectId: string,
  captainId: string,
): AgentLoop | null {
  const ctx = getServerContext();
  if (!ctx.gateway) return null;

  // Return cached if available (keyed by sessionId:roleType)
  const cacheKey = `${sessionId}:${roleType}`;
  const cached = agentLoopCache.get(cacheKey);
  if (cached) return cached;

  const registry = getServerContext().agentRegistry;
  const role = registry.get(roleType);
  if (!role) return null;

  const executor = new ToolExecutor();
  registerCabinetTools(executor, buildToolDependencies(ctx));
  registerSkillTools(executor);
  const mcpCtx = getServerContext();
  registerMCPTools(executor, (name, args) => mcpCtx.mcpManager.callTool(name, args), () => mcpCtx.mcpManager.listTools());

  // Wire observability: track tool calls
  executor.setToolCallCallback((toolName, success, blocked, durationMs) => {
    getServerContext().observability.recordToolCall(toolName, success, blocked, durationMs);
  });

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

  // FIFO eviction
  if (agentLoopCache.size >= MAX_CACHE_SIZE) {
    const firstKey = agentLoopCache.keys().next().value;
    if (firstKey) agentLoopCache.delete(firstKey);
  }
  // Wire observability: report session completion
  loop.onSessionComplete = (summary) => {
    const obs = getServerContext().observability;
    obs.recordSession({
      sessionId: summary.sessionId,
      projectId: summary.projectId,
      captainId: summary.captainId,
      role: role.type,
      model: summary.model,
      startTime: summary.startTime,
      totalSteps: summary.totalSteps,
      totalTokens: summary.totalTokens,
      totalCost: 0,
      toolCalls: summary.toolCalls,
      contextZoneDistribution: summary.contextZones,
      contextHandoffs: summary.contextHandoffs,
      qualityChecks: { total: 0, passed: 0 },
      errors: summary.errors,
      durationMs: summary.durationMs,
      success: summary.success,
    });
  };

  agentLoopCache.set(cacheKey, loop);
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
    secretaryAgentCache.clear();
    lastGatewayCheck = hasGateway;
  }

  const cached = secretaryAgentCache.get(sessionId);
  if (cached) {
    return { agent: cached };
  }

  // Secretary's own executor (all tools)
  const executor = new ToolExecutor();
  registerCabinetTools(executor, buildToolDependencies(ctx));
  registerSkillTools(executor);
  const mcpCtx = getServerContext();
  registerMCPTools(executor, (name, args) => mcpCtx.mcpManager.callTool(name, args), () => mcpCtx.mcpManager.listTools());
  executor.setToolCallCallback((toolName, success, blocked, durationMs) => {
    getServerContext().observability.recordToolCall(toolName, success, blocked, durationMs);
  });

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
      model,
      maxSteps: 10,
    });
    secretaryLoop.onSessionComplete = (summary) => {
      const obs = getServerContext().observability;
      obs.recordSession({
        sessionId: summary.sessionId,
        projectId: summary.projectId,
        captainId: summary.captainId,
        role: 'secretary',
        model: summary.model,
        startTime: summary.startTime,
        totalSteps: summary.totalSteps,
        totalTokens: summary.totalTokens,
        totalCost: 0,
        toolCalls: summary.toolCalls,
        contextZoneDistribution: summary.contextZones,
        contextHandoffs: summary.contextHandoffs,
        qualityChecks: { total: 0, passed: 0 },
        errors: summary.errors,
        durationMs: summary.durationMs,
        success: summary.success,
      });
    };
  }

  const intentParser = new IntentParser(hasGateway ? ctx.gateway! : undefined);

  // Initialize the router with agent descriptions and valid types (includes custom agents)
  const registry = getServerContext().agentRegistry;
  intentParser.setAgentDescriptions(registry.describeForRouting());
  intentParser.setValidAgentTypes(registry.getValidAgentTypes());

  const agent = new SecretaryAgent(
    secretaryLoop ?? (null as any),
    intentParser,
    ctx.sessionManager,
    ctx.gateway ?? undefined,
    // dispatchToRole callback: routes to specialist agents
    async (roleType, msg, sid) => {
      return dispatchToSpecialist(roleType, msg, sid, projectId, captainId);
    },
  );

  // FIFO eviction for secretary cache
  if (secretaryAgentCache.size >= MAX_CACHE_SIZE) {
    const firstKey = secretaryAgentCache.keys().next().value;
    if (firstKey) secretaryAgentCache.delete(firstKey);
  }
  secretaryAgentCache.set(sessionId, agent);

  return { agent };
}

const fileSchema = z
  .object({
    name: z.string(),
    path: z.string(),
    type: z.string().optional(),
  })
  .passthrough();

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
  let projectId: string = parsed.data.projectId || '';
  const model = parsed.data.model;
  const stream = parsed.data.stream ?? false;
  const dispatchMode: DispatchMode = parsed.data.dispatchMode ?? 'single';

  // Auto-create first project if none exist and no projectId specified
  if (!projectId) {
    const count = (ctx.db.prepare('SELECT COUNT(*) as count FROM projects').get() as any).count;
    if (count === 0) {
      const id = `proj_${Date.now()}`;
      ctx.db.prepare('INSERT INTO projects (id, name, description, last_activity_at) VALUES (?, ?, ?, datetime(\'now\'))')
        .run(id, 'My First Project', 'Auto-created project');
      ctx.db.prepare('INSERT INTO project_context (project_id, summary) VALUES (?, ?)').run(id, '');
      projectId = id;
      ctx.logger.info('Auto-created first project', { id });
    }
  }

  if (!ctx.sessionManager.get(sessionId)) {
    ctx.sessionManager.create(sessionId, `Session ${sessionId.slice(0, 8)}`);
  }

  try {
    const { agent } = getOrCreateAgent(sessionId, projectId || 'global', captainId, model);

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
          } catch {
            /* file not readable, skip content */
          }
        }
      }
      augmentedMessage = `${message}\n\n[Attached files]\n${fileLines.join('\n')}`;
    }

    if (ctx.gateway) {
      // ── Dispatch mode: pipeline or parallel ──
      if (dispatchMode === 'pipeline' || dispatchMode === 'parallel') {
        const executor = new ToolExecutor();
        registerCabinetTools(executor, buildToolDependencies(ctx));
  registerSkillTools(executor);
  const mcpCtx = getServerContext();
  registerMCPTools(executor, (name, args) => mcpCtx.mcpManager.callTool(name, args), () => mcpCtx.mcpManager.listTools());

        const dispatcher = new AgentDispatcher(
          ctx.gateway,
          executor,
          ctx.db,
          {
            async getShortTerm(sid: string) {
              const items: { role: 'user' | 'assistant'; content: string }[] = [];
              const session = ctx.sessionManager.get(sid);
              if (session && session.messages.length > 0) {
                // Include all messages except the current one (which is added separately by AgentLoop)
                const recentCount = Math.min(session.messages.length, 30);
                const start = Math.max(0, session.messages.length - recentCount);
                for (let i = start; i < session.messages.length; i++) {
                  const m = session.messages[i]!;
                  items.push({ role: m.role, content: m.content });
                }
              }
              const kv = ctx.shortTerm.getAll(sid);
              for (const [k, v] of Object.entries(kv)) {
                if (typeof v === 'string' && v.length > 0) {
                  items.push({ role: 'user' as const, content: `[${k}]: ${v}` });
                }
              }
              return items;
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
              return results.map((r) => `[Memory] ${r.content}`);
            },
          },
          ctx.eventBus,
          ctx.agentRegistry,
        );

        const result = await dispatcher.dispatch({
          mode: dispatchMode,
          request: augmentedMessage,
          sessionId,
          projectId,
          captainId,
        });

        ctx.metrics.increment('llm_call', {
          model: model ?? 'claude-sonnet-4-6',
          purpose: dispatchMode,
        });
        broadcast('secretary_message', { sessionId, projectId, captainId, mode: dispatchMode });

        return c.json({
          sessionId,
          projectId,
          captainId,
          response: result.finalOutput,
          dispatchMode,
          steps: result.steps.map((s) => ({
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
      // SSE streaming path
      if (stream) {
        const sseStream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            function emit(type: string, data: Record<string, unknown>) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`));
            }
            try {
              capturedMeetingResult = null; // Reset before running
              emit('status', { message: 'Thinking...' });
              const result = await agent.handleMessage(sessionId, augmentedMessage);
              const meeting = capturedMeetingResult;

              if (result.routeResult) {
                emit('routing', {
                  targetAgent: result.routeResult.targetAgent,
                  confidence: result.routeResult.confidence,
                  reasoning: result.routeResult.reasoning,
                });
              }
              if (result.intent) {
                emit('intent', { kind: result.intent.kind, detail: result.intent });
              }

              // Stream response sentence by sentence for visual feedback
              const sentences = result.response.split(/(?<=[。！？.!?\n])/);
              for (const sentence of sentences) {
                if (sentence.trim()) {
                  emit('chunk', { content: sentence });
                }
              }

              if ((result as any).usage) {
                ctx.costTracker.record(
                  model ?? 'claude-sonnet-4-6',
                  (result as any).usage.promptTokens ?? 0,
                  (result as any).usage.completionTokens ?? 0,
                );
              }
              ctx.metrics.increment('llm_call', { model: model ?? 'claude-sonnet-4-6', purpose: 'chat' });
              broadcast('secretary_message', { sessionId, projectId, captainId, mode: 'single' });

              emit('done', { sessionId, meeting: meeting ?? undefined, agentName: 'Secretary' });
            } catch (e: any) {
              emit('error', { message: e.message ?? 'Unknown error' });
            } finally {
              controller.close();
            }
          },
        });

        return new Response(sseStream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        });
      }

      // ── Non-streaming single mode ──
      capturedMeetingResult = null; // Reset before running
      const result = await agent.handleMessage(sessionId, augmentedMessage);
      const meeting = capturedMeetingResult; // Capture any meeting created by tools

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
        sessionId,
        projectId,
        captainId,
        response: result.response,
        intent: result.intent,
        route: result.routeResult
          ? {
              targetAgent: result.routeResult.targetAgent,
              confidence: result.routeResult.confidence,
              reasoning: result.routeResult.reasoning,
              suggestion: result.routeResult.suggestion,
            }
          : undefined,
        mode: 'single',
        dispatchMode: 'single',
        model: model ?? 'claude-sonnet-4-6',
        toolCalls: (result as any).toolCalls ?? 0,
        meeting: meeting ?? undefined,
        agentName: 'Secretary',
      });
    } else {
      const parser = new IntentParser();
      const intent = parser.parse(message);
      ctx.sessionManager.addMessage(sessionId, 'user', message);
      const response = `[No API key] Intent: ${intent.kind}. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env for LLM mode.`;
      ctx.sessionManager.addMessage(sessionId, 'assistant', response);
      broadcast('secretary_message', { sessionId, projectId, captainId, mode: 'fallback' });
      return c.json({
        sessionId,
        projectId,
        captainId,
        response,
        intent,
        mode: 'fallback',
        model: 'none',
      });
    }
  } catch (error) {
    const msg = (error as Error).message;
    ctx.logger.error('Secretary agent error', { error: msg });
    const isAuthError =
      msg.includes('API key') || msg.includes('not configured') || msg.includes('401');
    return c.json(
      {
        sessionId,
        projectId,
        captainId,
        response: `Error: ${msg}`,
        intent: { kind: 'unknown' },
        mode: 'error',
      },
      isAuthError ? 503 : 500,
    );
  }
});

// ── GET /verify ──
secretaryRouter.get('/verify', async (c) => {
  const { gateway, costTracker, metrics } = getServerContext();
  if (!gateway) {
    return c.json({
      status: 'no_api_key',
      message: 'Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env to enable LLM.',
    });
  }
  try {
    const start = Date.now();
    const response = await gateway.generateText({
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'Reply with just "OK".' }],
      maxTokens: 10,
    });
    costTracker.record(
      'claude-haiku-4-5',
      response.usage?.promptTokens ?? 0,
      response.usage?.completionTokens ?? 0,
    );
    metrics.increment('llm_call', { model: 'claude-haiku-4-5', purpose: 'verify' });
    const latency = Date.now() - start;
    return c.json({
      status: 'ok',
      latency_ms: latency,
      model: response.model,
      tokens: response.usage,
    });
  } catch (error) {
    return c.json(
      {
        status: 'error',
        message: (error as Error).message,
        hint: 'Check your API key and network connection.',
      },
      503,
    );
  }
});

// ── GET /sessions ──
secretaryRouter.get('/sessions', (c) => {
  const { sessionManager } = getServerContext();
  const sessions = sessionManager.list();
  return c.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      title: s.title,
      messageCount: s.messages.length,
      updatedAt: s.updatedAt,
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

  // Use actual model context window (claude-sonnet-4-6 = 200k, but report accurately)
  const maxContextTokens = 200000;

  return c.json({
    sessionId,
    messageCount,
    estimatedTokens,
    maxContextTokens,
    summary: metrics.getSummary(),
  });
});

// ── POST /compact ──
secretaryRouter.post('/compact', async (c) => {
  const ctx = getServerContext();
  const body = await c.req.json().catch(() => ({}));
  const sessionId = body.sessionId ?? 'default';

  const session = ctx.sessionManager.get(sessionId);
  if (!session) return c.json({ compacted: false, reason: 'Session not found' }, 404);

  const messages = session.messages;
  if (messages.length <= 4) return c.json({ compacted: true, messageCount: messages.length });

  // Keep last 4 messages intact, summarize older ones
  const keepCount = 4;
  const toSummarize = messages.slice(0, messages.length - keepCount);
  const recent = messages.slice(messages.length - keepCount);

  // Build a summary from old messages
  const summaryParts: string[] = [];
  let lastRole = '';
  for (const m of toSummarize) {
    if (m.role !== lastRole) {
      summaryParts.push(`${m.role === 'user' ? 'User asked' : 'Assistant responded'} about: ${m.content.slice(0, 200)}`);
      lastRole = m.role;
    }
  }

  const summary = `[Context summary: ${toSummarize.length} earlier messages compressed. Key topics: ${summaryParts.slice(0, 5).join('; ')}]`;

  // Replace old messages with summary + recent
  session.messages.length = 0;
  session.messages.push({ role: 'user', content: summary, timestamp: new Date() });
  for (const m of recent) {
    session.messages.push(m);
  }

  return c.json({
    compacted: true,
    previousCount: messages.length,
    newCount: session.messages.length,
    estimatedTokens: Math.ceil(session.messages.reduce((sum, m) => sum + m.content.length, 0) / 4),
  });
});

// ── GET /greeting ──
secretaryRouter.get('/greeting', (c) => {
  const { db, costTracker } = getServerContext();
  const greeter = new GreetingService();

  const pendingDecisions = (
    db.prepare("SELECT COUNT(*) as count FROM decisions WHERE status = 'pending'").get() as any
  ).count as number;
  const activeWorkflows = (
    db.prepare(
      "SELECT COUNT(*) as count FROM workflows WHERE status IN ('running', 'awaiting_approval')",
    ).get() as any
  ).count as number;
  const todayCost = costTracker.getDailyCost();

  const result = greeter.generate({
    captainName: 'Captain',
    pendingDecisions,
    activeWorkflows,
    todayCost,
  });

  return c.json(result);
});
