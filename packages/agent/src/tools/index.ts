import { ToolExecutor, type ToolDefinition } from '../tool-executor.js';
import type { EventBus } from '@cabinet/events';
import type { ShortTermMemory, LongTermMemory, EntityMemory, ProjectMemory } from '@cabinet/memory';
import { MessageType, DEFAULT_CAPTAIN_ID, DEFAULT_CAPTAIN_NAME, type DecisionStore, type Decision } from '@cabinet/types';
import { getSkillRegistry } from '../skill-registry.js';
import { createFileTools, type FileToolDeps } from './file-tools.js';
import { createWebTools, type WebToolDeps } from './web-tools.js';
import { createShellTools, type ShellToolDeps } from './shell-tools.js';
import { createSchedulerTools, type SchedulerToolDeps } from './scheduler-tools.js';
import { createKnowledgeTools, type KnowledgeToolDeps } from './knowledge-tools.js';
import { createEvaluationTools, type EvaluationToolDeps } from './evaluation-tools.js';
import { createLSPTools, type LSPToolDeps } from './lsp-tools.js';

export interface ToolDependencies extends FileToolDeps, WebToolDeps, ShellToolDeps, SchedulerToolDeps, KnowledgeToolDeps, EvaluationToolDeps, LSPToolDeps {
  // ── Existing (read path) ──
  decisionStore: DecisionStore;
  eventBus: EventBus;
  shortTerm: ShortTermMemory;
  longTerm: LongTermMemory;
  entity: EntityMemory;
  project: ProjectMemory;

  // ── Write callbacks (wired by server layer) ──
  createDecision: (input: {
    projectId: string;
    type: import('@cabinet/types').DecisionType;
    title: string;
    description: string;
    options: { id: string; label: string; impact: string }[];
    classification: {
      scopeDescription: string;
      isCrossSession: boolean;
      optionCount: number;
      estimatedCostUsd: number;
      involvesFunds: boolean;
      involvesPermissions: boolean;
      involvesDataDeletion: boolean;
      involvesOrgConfig: boolean;
    };
    captainId?: string;
  }) => Decision;
  approveDecision: (decisionId: string, captainId: string, chosenOptionId: string) => Decision;
  rejectDecision: (decisionId: string, captainId: string) => Decision;

  listWorkflows: () => { id: string; name: string; status: string; stepCount: number }[];
  getWorkflow: (id: string) => { id: string; name: string; definition: unknown; status: string } | undefined;
  createWorkflow: (input: { name: string; projectId: string; definition: unknown }) => {
    id: string;
  };
  updateWorkflow: (id: string, input: { name?: string; definition?: unknown }) => void;
  deleteWorkflow: (id: string) => void;
  runWorkflow: (id: string) => Promise<{ runId: string; status: string; steps?: unknown[] }>;

  startMeeting: (
    topic: string,
    advisorIds?: string[],
    projectId?: string,
  ) => Promise<{
    meetingId: string;
    topic: string;
    synthesis: string;
    perspectives: unknown[];
  }>;

  writeLongTermMemory: (content: string, metadata?: Record<string, unknown>) => Promise<string>;
  createEmployee: (input: { name: string; role: string; kind: string }) => void;

  registerAgent: (input: {
    name: string;
    description: string;
    systemPrompt: string;
    model: string;
    temperature: number;
    maxResponseTokens: number;
    allowedTools: string[];
    contextBudget: number;
  }) => { type: string; name: string };
  updateAgent: (name: string, updates: Record<string, unknown>) => void;
  deleteAgent: (name: string) => void;
  listAgents: () => { type: string; name: string; description: string; builtIn: boolean }[];
  invokeAgent: (agentName: string, message: string) => Promise<{ agentName: string; response: string }>;

  // Project tools
  setProjectContext: (projectId: string) => { id: string; name: string };
  createProject: (input: { name: string; description?: string; rootPath?: string }) => { id: string; name: string };
  listProjects: () => { id: string; name: string; lastActivityAt?: string; activeWorkflowCount?: number }[];
  getProjectContext: (projectId: string) => Record<string, unknown> | null;
}

export function createCabinetTools(deps: ToolDependencies): ToolDefinition[] {
  return [
    // ═══════════════════════════════════════════════════════════
    // Decision Tools (read)
    // ═══════════════════════════════════════════════════════════
    {
      name: 'query_decisions',
      execute: async (args: Record<string, unknown>) => {
        const status = (args.status as string) ?? 'pending';
        const projectId = args.projectId as string | undefined;
        if (projectId) {
          return deps.decisionStore
            .listByProject(projectId)
            .filter((d: Decision) => status === 'all' || d.status === status);
        }
        return deps.decisionStore.listPending(projectId ?? 'all');
      },
    },
    {
      name: 'get_decision',
      execute: async (args: Record<string, unknown>) => {
        const id = args.decisionId as string;
        const decision = deps.decisionStore.get(id);
        if (!decision) return { error: `Decision not found: ${id}` };
        return decision;
      },
    },

    // ═══════════════════════════════════════════════════════════
    // Decision Tools (write)
    // ═══════════════════════════════════════════════════════════
    {
      name: 'create_decision',
      execute: async (args: Record<string, unknown>) => {
        const title = args.title as string;
        const description = (args.description as string) ?? '';
        const type = (args.type as import('@cabinet/types').DecisionType) ?? 'strategic';
        const projectId = (args.projectId as string) ?? 'default';
        const captainId = args.captainId as string | undefined;
        const options = (args.options as { id: string; label: string; impact: string }[]) ?? [
          { id: 'opt_approve', label: 'Approve', impact: 'Proceed as described' },
          { id: 'opt_reject', label: 'Reject', impact: 'Do not proceed' },
        ];
        const classification = {
          scopeDescription: (args.scopeDescription as string) ?? description.slice(0, 200),
          isCrossSession: (args.isCrossSession as boolean) ?? false,
          optionCount: (args.optionCount as number) ?? options.length,
          estimatedCostUsd: (args.estimatedCostUsd as number) ?? 0,
          involvesFunds: (args.involvesFunds as boolean) ?? false,
          involvesPermissions: (args.involvesPermissions as boolean) ?? false,
          involvesDataDeletion: (args.involvesDataDeletion as boolean) ?? false,
          involvesOrgConfig: (args.involvesOrgConfig as boolean) ?? false,
        };
        return deps.createDecision({
          projectId,
          type,
          title,
          description,
          options,
          classification,
          captainId,
        });
      },
    },
    {
      name: 'approve_decision',
      execute: async (args: Record<string, unknown>) => {
        const decisionId = args.decisionId as string;
        const captainId = (args.captainId as string) ?? DEFAULT_CAPTAIN_ID;
        const chosenOptionId = (args.chosenOptionId as string) ?? (args.optionId as string);
        if (!decisionId || !chosenOptionId) {
          return { error: 'decisionId and chosenOptionId are required' };
        }
        return deps.approveDecision(decisionId, captainId, chosenOptionId);
      },
    },
    {
      name: 'reject_decision',
      execute: async (args: Record<string, unknown>) => {
        const decisionId = args.decisionId as string;
        const captainId = (args.captainId as string) ?? DEFAULT_CAPTAIN_ID;
        if (!decisionId) return { error: 'decisionId is required' };
        return deps.rejectDecision(decisionId, captainId);
      },
    },

    // ═══════════════════════════════════════════════════════════
    // Event/Monitoring Tools
    // ═══════════════════════════════════════════════════════════
    {
      name: 'get_recent_events',
      execute: async (args: Record<string, unknown>) => {
        const correlationId = args.correlationId as string | undefined;
        if (correlationId) {
          return deps.eventBus.getCausationChain(correlationId);
        }
        return { message: 'Provide correlationId to trace event chain' };
      },
    },
    {
      name: 'publish_notification',
      execute: async (args: Record<string, unknown>) => {
        const messageId = `tool_notify_${Date.now()}`;
        await deps.eventBus.publish({
          messageId,
          correlationId: messageId,
          causationId: null,
          timestamp: new Date(),
          messageType: MessageType.SystemNotification,
          payload: { message: args.message as string, level: (args.level as string) ?? 'info' },
        });
        return { published: true, messageId };
      },
    },

    // ═══════════════════════════════════════════════════════════
    // Memory Tools (read + write)
    // ═══════════════════════════════════════════════════════════
    {
      name: 'remember',
      execute: async (args: Record<string, unknown>) => {
        const sessionId = args.sessionId as string;
        const key = args.key as string;
        const value = args.value;
        deps.shortTerm.set(sessionId, key, value, (args.ttlMs as number) ?? undefined);
        return { remembered: true, key };
      },
    },
    {
      name: 'recall',
      timeoutMs: 30000,
      execute: async (args: Record<string, unknown>) => {
        const sessionId = args.sessionId as string;
        const key = args.key as string | undefined;
        if (key) {
          const val = deps.shortTerm.get(sessionId, key);
          return val !== null ? { key, value: val } : { key, notFound: true };
        }
        return deps.shortTerm.getAll(sessionId);
      },
    },
    {
      name: 'search_memory',
      timeoutMs: 30000,
      execute: async (args: Record<string, unknown>) => {
        const query = args.query as string;
        const limit = (args.limit as number) ?? 5;
        const results = await deps.longTerm.search(query, limit);
        return results.map((r) => ({
          content: r.content,
          timestamp: r.timestamp,
          metadata: r.metadata,
        }));
      },
    },
    {
      name: 'write_memory',
      execute: async (args: Record<string, unknown>) => {
        const content = args.content as string;
        const metadata = (args.metadata as Record<string, unknown>) ?? {};
        if (!content || content.length < 10) {
          return { error: 'Content must be at least 10 characters' };
        }
        const id = await deps.writeLongTermMemory(content, metadata);
        return { stored: true, id, preview: content.slice(0, 200) };
      },
    },

    // ═══════════════════════════════════════════════════════════
    // Project Tools (read + write)
    // ═══════════════════════════════════════════════════════════
    {
      name: 'get_project_context',
      execute: async (args: Record<string, unknown>) => {
        const projectId = args.projectId as string;
        const ctx = deps.project.get(projectId);
        if (!ctx) return { error: `Project not found: ${projectId}` };
        return {
          goals: ctx.goals,
          milestones: ctx.milestones,
          keyDecisions: ctx.keyDecisions,
          summary: ctx.summary,
        };
      },
    },
    {
      name: 'add_milestone',
      execute: async (args: Record<string, unknown>) => {
        const projectId = (args.projectId as string) ?? 'default';
        const title = args.title as string;
        if (!title) return { error: 'title is required' };
        deps.project.addMilestone(projectId, title);
        return { added: true, projectId, title };
      },
    },
    {
      name: 'update_project_summary',
      execute: async (args: Record<string, unknown>) => {
        const projectId = (args.projectId as string) ?? 'default';
        const summary = args.summary as string;
        if (!summary) return { error: 'summary is required' };
        deps.project.updateSummary(projectId, summary);
        return { updated: true, projectId, preview: summary.slice(0, 200) };
      },
    },
    {
      name: 'get_captain_preferences',
      execute: async (args: Record<string, unknown>) => {
        const captainId = args.captainId as string;
        const prefs = deps.entity.getPreferences(captainId);
        return prefs ?? { captainId, preferences: {} };
      },
    },
    {
      name: 'set_captain_preferences',
      execute: async (args: Record<string, unknown>) => {
        const captainId = (args.captainId as string) ?? DEFAULT_CAPTAIN_ID;
        const name = (args.name as string) ?? DEFAULT_CAPTAIN_NAME;
        const prefs = (args.preferences as Record<string, unknown>) ?? {};
        deps.entity.setPreferences(captainId, name, prefs);
        return { updated: true, captainId };
      },
    },

    // ═══════════════════════════════════════════════════════════
    // Workflow Tools (read + write)
    // ═══════════════════════════════════════════════════════════
    {
      name: 'list_workflows',
      execute: async (_args: Record<string, unknown>) => {
        const workflows = deps.listWorkflows();
        return { workflows };
      },
    },
    {
      name: 'get_workflow',
      execute: async (args: Record<string, unknown>) => {
        const workflowId = args.workflowId as string;
        if (!workflowId) return { error: 'workflowId is required' };
        const wf = deps.getWorkflow(workflowId);
        if (!wf) return { error: `Workflow not found: ${workflowId}` };
        return {
          id: wf.id,
          name: wf.name,
          status: wf.status,
          definition: wf.definition,
        };
      },
    },
    {
      name: 'create_workflow',
      execute: async (args: Record<string, unknown>) => {
        const name = (args.name as string) ?? 'Untitled Workflow';
        const projectId = (args.projectId as string) ?? 'default';
        const definition = (args.definition as unknown) ?? { nodes: [], edges: [] };
        const result = deps.createWorkflow({ name, projectId, definition });
        return { created: true, workflowId: result.id, name, projectId };
      },
    },
    {
      name: 'update_workflow',
      execute: async (args: Record<string, unknown>) => {
        const workflowId = args.workflowId as string;
        if (!workflowId) return { error: 'workflowId is required' };
        const name = args.name as string | undefined;
        const definition = args.definition as unknown | undefined;
        deps.updateWorkflow(workflowId, { name, definition });
        return { updated: true, workflowId };
      },
    },
    {
      name: 'run_workflow',
      execute: async (args: Record<string, unknown>) => {
        const workflowId = args.workflowId as string;
        if (!workflowId) return { error: 'workflowId is required' };
        const result = await deps.runWorkflow(workflowId);
        return { executed: true, ...result };
      },
    },
    {
      name: 'delete_workflow',
      execute: async (args: Record<string, unknown>) => {
        const workflowId = args.workflowId as string;
        if (!workflowId) return { error: 'workflowId is required' };
        deps.deleteWorkflow(workflowId);
        return { deleted: true, workflowId };
      },
    },

    // ═══════════════════════════════════════════════════════════
    // Meeting Tools
    // ═══════════════════════════════════════════════════════════
    {
      name: 'start_meeting',
      execute: async (args: Record<string, unknown>) => {
        const topic = args.topic as string;
        if (!topic) return { error: 'topic is required' };
        const advisorIds = (args.advisors as string[]) ?? undefined;
        const projectId = args.projectId as string | undefined;
const result = await deps.startMeeting(topic, advisorIds, projectId);
        return {
          meetingId: result.meetingId,
          topic: result.topic,
          synthesis: result.synthesis,
          advisorCount: result.perspectives.length,
        };
      },
    },

    // ═══════════════════════════════════════════════════════════
    // Employee Tools
    // ═══════════════════════════════════════════════════════════
    {
      name: 'create_employee',
      execute: async (args: Record<string, unknown>) => {
        const name = args.name as string;
        const role = (args.role as string) ?? 'advisor';
        const kind = (args.kind as string) ?? 'ai';
        if (!name) return { error: 'name is required' };
        deps.createEmployee({ name, role, kind });
        return { created: true, name, role, kind };
      },
    },

    // ═══════════════════════════════════════════════════════════
    // Agent Management Tools
    // ═══════════════════════════════════════════════════════════
    {
      name: 'list_agents',
      execute: async (_args: Record<string, unknown>) => {
        return deps.listAgents();
      },
    },
    {
      name: 'register_agent',
      execute: async (args: Record<string, unknown>) => {
        const name = args.name as string;
        const description = (args.description as string) ?? '';
        const systemPrompt = (args.systemPrompt as string) ?? '';
        const model = (args.model as string) ?? 'claude-haiku-4-5';
        const temperature = (args.temperature as number) ?? 0.3;
        const maxResponseTokens = (args.maxResponseTokens as number) ?? 4000;
        const allowedTools = (args.allowedTools as string[]) ?? [];
        const contextBudget = (args.contextBudget as number) ?? 0.3;

        if (!name) return { error: 'name is required' };
        if (!/^[\w一-鿿\s-]{2,64}$/.test(name)) {
          return { error: 'Invalid agent name. Use 2-64 characters: letters, digits, Chinese, underscores, hyphens, spaces.' };
        }
        if (!systemPrompt) return { error: 'systemPrompt is required' };

        return deps.registerAgent({
          name,
          description,
          systemPrompt,
          model,
          temperature,
          maxResponseTokens,
          allowedTools,
          contextBudget,
        });
      },
    },
    {
      name: 'update_agent',
      execute: async (args: Record<string, unknown>) => {
        const name = args.name as string;
        if (!name) return { error: 'name is required' };
        const updates: Record<string, unknown> = {};
        if (args.description !== undefined) updates.description = args.description;
        if (args.systemPrompt !== undefined) updates.systemPrompt = args.systemPrompt;
        if (args.model !== undefined) updates.model = args.model;
        if (args.temperature !== undefined) updates.temperature = args.temperature;
        if (args.maxResponseTokens !== undefined) updates.maxResponseTokens = args.maxResponseTokens;
        if (args.allowedTools !== undefined) updates.allowedTools = args.allowedTools;
        if (args.contextBudget !== undefined) updates.contextBudget = args.contextBudget;
        deps.updateAgent(name, updates);
        return { updated: true, name };
      },
    },
    {
      name: 'delete_agent',
      execute: async (args: Record<string, unknown>) => {
        const name = args.name as string;
        if (!name) return { error: 'name is required' };
        deps.deleteAgent(name);
        return { deleted: true, name };
      },
    },
    {
      name: 'invoke_agent',
      execute: async (args: Record<string, unknown>) => {
        const agentName = args.agentName as string;
        const message = args.message as string;
        if (!agentName) return { error: 'agentName is required' };
        if (!message) return { error: 'message is required' };
        return deps.invokeAgent(agentName, message);
      },
    },

    // ═══════════════════════════════════════════════════════════
    // Project Tools
    // ═══════════════════════════════════════════════════════════
    {
      name: 'set_project_context',
      execute: async (args: Record<string, unknown>) => {
        const projectId = args.projectId as string;
        if (!projectId) return { error: 'projectId is required' };
        const result = deps.setProjectContext(projectId);
        return { activeProject: result };
      },
    },
    {
      name: 'create_project',
      execute: async (args: Record<string, unknown>) => {
        const name = args.name as string;
        if (!name) return { error: 'name is required' };
        const result = deps.createProject({
          name,
          description: args.description as string,
          rootPath: args.rootPath as string,
        });
        return { project: result };
      },
    },
    {
      name: 'list_projects',
      execute: async (_args: Record<string, unknown>) => {
        return { projects: deps.listProjects() };
      },
    },
    {
      name: 'get_project_context',
      execute: async (args: Record<string, unknown>) => {
        const projectId = args.projectId as string;
        if (!projectId) return { error: 'projectId is required' };
        return { context: deps.getProjectContext(projectId) };
      },
    },

    // ═══════════════════════════════════════════════════════════
    // Status/Health Tools
    // ═══════════════════════════════════════════════════════════
    {
      name: 'get_status',
      execute: async (_args: Record<string, unknown>) => {
        return {
          status: 'operational',
          timestamp: new Date().toISOString(),
          toolsAvailable: 49,
        };
      },
    },

    // ═══════════════════════════════════════════════════════════
    // File System Tools
    // ═══════════════════════════════════════════════════════════
    ...createFileTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Web / HTTP Tools
    // ═══════════════════════════════════════════════════════════
    ...createWebTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Shell Execution Tools
    // ═══════════════════════════════════════════════════════════
    ...createShellTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Scheduler Tools
    // ═══════════════════════════════════════════════════════════
    ...createSchedulerTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Knowledge / RAG Tools
    // ═══════════════════════════════════════════════════════════
    ...createKnowledgeTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Evaluation Tools
    // ═══════════════════════════════════════════════════════════
    ...createEvaluationTools(deps),

    // ═══════════════════════════════════════════════════════════
    // LSP Tools
    // ═══════════════════════════════════════════════════════════
    ...createLSPTools(deps),
  ];
}

export function registerCabinetTools(executor: ToolExecutor, deps: ToolDependencies): ToolExecutor {
  const tools = createCabinetTools(deps);
  for (const tool of tools) {
    executor.register(tool);
  }
  return executor;
}

/** Register MCP tools from an MCP manager (must provide callTool function). */
export function registerMCPTools(
  executor: ToolExecutor,
  mcpCallTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  mcpListTools: () => { serverName: string; name: string; description: string; inputSchema: Record<string, unknown> }[],
): ToolExecutor {
  for (const tool of mcpListTools()) {
    const fullName = `mcp__${tool.name}`;
    executor.register({
      name: fullName,
      execute: async (args: Record<string, unknown>) => {
        const result = await mcpCallTool(fullName, args);
        return result;
      },
    });
  }
  return executor;
}

/** Register per-skill tools (use_skill__name) from the SkillRegistry. */
export function registerSkillTools(executor: ToolExecutor): ToolExecutor {
  const registry = getSkillRegistry();
  const skillTools = registry.getToolDefinitions();
  for (const tool of skillTools) {
    executor.register(tool);
  }

  // Also register the generic use_skill dispatcher
  executor.register({
    name: 'use_skill',
    execute: async (args: Record<string, unknown>) => {
      const skillName = args.skill as string;
      if (!skillName) return { error: 'skill name is required' };
      const skill = registry.load(skillName);
      if (!skill) return { error: `Skill not found: ${skillName}` };
      const result = await registry.executeSkill(skill, args);
      return result;
    },
  });

  return executor;
}
