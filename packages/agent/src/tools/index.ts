import { ToolExecutor, type ToolDefinition } from '../tool-executor.js';
import type { EventBus } from '@cabinet/events';
import type { ShortTermMemory, LongTermMemory, EntityMemory, ProjectMemory } from '@cabinet/memory';
import {
  MessageType,
  DEFAULT_CAPTAIN_ID,
  DEFAULT_CAPTAIN_NAME,
  type DecisionStore,
  type Decision,
} from '@cabinet/types';
import { getSkillRegistry } from '../skill-registry.js';
import { createFileTools, type FileToolDeps } from './file-tools.js';
import { createWebTools, type WebToolDeps } from './web-tools.js';
import { createShellTools, type ShellToolDeps } from './shell-tools.js';
import { createSchedulerTools, type SchedulerToolDeps } from './scheduler-tools.js';
import { createKnowledgeTools, type KnowledgeToolDeps } from './knowledge-tools.js';
import { createEvaluationTools, type EvaluationToolDeps } from './evaluation-tools.js';
import { createLSPTools, type LSPToolDeps } from './lsp-tools.js';
import {
  createSystemKnowledgeTools,
  type SystemKnowledgeToolDeps,
} from './system-knowledge-tools.js';
import { createDocumentTools, type DocumentToolDeps } from './document-tools.js';
import { createArchiveTools, type ArchiveToolDeps } from './archive-tools.js';
import { createBrowserTools, type BrowserToolDeps } from './browser-tools.js';
import { createCommunicationTools, type CommunicationToolDeps } from './communication-tools.js';
import { createSystemTools, type SystemToolDeps } from './system-tools.js';

export interface ToolDependencies
  extends
    FileToolDeps,
    WebToolDeps,
    ShellToolDeps,
    SchedulerToolDeps,
    KnowledgeToolDeps,
    EvaluationToolDeps,
    LSPToolDeps,
    SystemKnowledgeToolDeps,
    DocumentToolDeps,
    ArchiveToolDeps,
    BrowserToolDeps,
    CommunicationToolDeps,
    SystemToolDeps {
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
      estimatedCost: number;
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
  getWorkflow: (
    id: string,
  ) => { id: string; name: string; definition: unknown; status: string } | undefined;
  createWorkflow: (input: { name: string; projectId: string; definition: unknown }) => {
    id: string;
  };
  updateWorkflow: (id: string, input: { name?: string; definition?: unknown }) => void;
  deleteWorkflow: (id: string) => void;
  runWorkflow: (id: string) => Promise<{ runId: string; status: string; steps?: unknown[] }>;

  getWorkflowRun: (runId: string) => {
    runId: string;
    workflowId: string;
    status: string;
    steps: unknown[];
    startedAt: string;
    updatedAt: string;
  } | null;
  listWorkflowRuns: (workflowId: string) => Array<{
    runId: string;
    workflowId: string;
    status: string;
    startedAt: string;
    updatedAt: string;
  }>;

  writeLongTermMemory: (content: string, metadata?: Record<string, unknown>) => Promise<string>;
  createEmployee: (input: { name: string; role: string; kind: string }) => void;

  registerAgent: (input: {
    name: string;
    description: string;
    systemPrompt: string;
    modelTier: string;
    temperature: number;
    maxResponseTokens: number;
    allowedTools: string[];
    contextBudget: number;
  }) => { type: string; name: string };
  updateAgent: (name: string, updates: Record<string, unknown>) => void;
  deleteAgent: (name: string) => void;
  listAgents: () => { type: string; name: string; description: string; builtIn: boolean }[];
  invokeAgent: (
    agentName: string,
    message: string,
    callerSessionId?: string,
  ) => Promise<{ agentName: string; response: string }>;

  // Project tools
  setProjectContext: (projectId: string) => { id: string; name: string };
  createProject: (input: { name: string; description?: string; rootPath?: string }) => {
    id: string;
    name: string;
  };
  listProjects: () => {
    id: string;
    name: string;
    lastActivityAt?: string;
    activeWorkflowCount?: number;
  }[];
  getProjectContext: (projectId: string) => Record<string, unknown> | null;

  getDashboardStats: () => {
    pendingDecisions: number;
    activeWorkflows: number;
    activeProjects: number;
    todayCost: number;
    totalLLMCalls: number;
    totalTokens: number;
    totalDecisions: number;
    errors: number;
    recentEvents: { message: string; time: string }[];
  };

  delegateTask: (name: string, agentName?: string, description?: string) => string;
  getTaskStatus: (
    taskId: string,
  ) => { id: string; name: string; status: string; startTime?: number; endTime?: number } | null;
  listActiveTasks: () => { id: string; name: string; status: string }[];

  getDecisionAudit: (decisionId: string) => Array<{
    action: string;
    actor: string;
    changes: Record<string, unknown>;
    timestamp: string;
  }>;

  getSystemMetrics: () => {
    totalLLMCalls: number;
    totalTokens: number;
    totalDecisions: number;
    errors: number;
  };

  generateEmbeddings: (texts: string[]) => Promise<number[][]>;
}

export function createCabinetTools(deps: ToolDependencies): ToolDefinition[] {
  return [
    // ═══════════════════════════════════════════════════════════
    // Decision Tools (read)
    // ═══════════════════════════════════════════════════════════
    {
      name: 'query_decisions',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status: pending, approved, rejected, expired, archived, or all (default: pending)' },
          projectId: { type: 'string', description: 'Filter by project ID (omit for all projects)' },
        },
      },
      execute: async (args: Record<string, unknown>) => {
        const status = (args.status as string) ?? 'pending';
        const projectId = args.projectId as string | undefined;
        if (projectId) {
          return deps.decisionStore
            .listByProject(projectId)
            .filter((d: Decision) => status === 'all' || d.status === status);
        }
        return status === 'all'
          ? deps.decisionStore.listAll()
          : deps.decisionStore.listAllPending();
      },
    },
    {
      name: 'get_decision',
      parameters: {
        type: 'object',
        properties: {
          decisionId: { type: 'string', description: 'ID of the decision to retrieve' },
        },
        required: ['decisionId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const id = args.decisionId as string;
        const decision = deps.decisionStore.get(id);
        if (!decision) return { error: `Decision not found: ${id}` };
        return decision;
      },
    },
    {
      name: 'get_decision_audit',
      parameters: {
        type: 'object',
        properties: {
          decisionId: { type: 'string', description: 'ID of the decision to get audit trail for' },
        },
        required: ['decisionId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const decisionId = args.decisionId as string;
        if (!decisionId) return { error: 'decisionId is required' };
        const entries = deps.getDecisionAudit(decisionId);
        return { decisionId, entries };
      },
    },

    // ═══════════════════════════════════════════════════════════
    // Decision Tools (write)
    // ═══════════════════════════════════════════════════════════
    {
      name: 'create_decision',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Decision title (short, actionable)' },
          description: { type: 'string', description: 'Detailed description of what is being decided' },
          type: { type: 'string', description: 'Decision type: strategic, technical, resource, or process (default: strategic)' },
          projectId: { type: 'string', description: 'Project ID (default: "default")' },
          options: { type: 'array', description: 'Array of {id, label, impact} option objects' },
          scopeDescription: { type: 'string', description: 'Scope description for level classification' },
          estimatedCost: { type: 'number', description: 'Estimated cost in RMB for level classification' },
          involvesFunds: { type: 'boolean', description: 'Whether decision involves financial transactions' },
          involvesPermissions: { type: 'boolean', description: 'Whether decision involves permission changes' },
          involvesDataDeletion: { type: 'boolean', description: 'Whether decision involves data deletion' },
          involvesOrgConfig: { type: 'boolean', description: 'Whether decision involves org-wide config changes' },
        },
        required: ['title'],
      },
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
          estimatedCost: (args.estimatedCost as number) ?? 0,
          involvesFunds: (args.involvesFunds as boolean) ?? false,
          involvesPermissions: (args.involvesPermissions as boolean) ?? false,
          involvesDataDeletion: (args.involvesDataDeletion as boolean) ?? false,
          involvesOrgConfig: (args.involvesOrgConfig as boolean) ?? false,
        };
        const result = deps.createDecision({
          projectId,
          type,
          title,
          description,
          options,
          classification,
          captainId,
        });
        // Link decision to project context so it appears in get_project_context
        try {
          deps.project.addDecision(projectId, title, `Decision created (${type})`);
        } catch {
          /* best-effort: project context linking is non-critical */
        }
        return result;
      },
    },
    {
      name: 'approve_decision',
      parameters: {
        type: 'object',
        properties: {
          decisionId: { type: 'string', description: 'ID of the decision to approve' },
          chosenOptionId: { type: 'string', description: 'ID of the chosen option' },
          captainId: { type: 'string', description: 'ID of the Captain approving (default: current user)' },
        },
        required: ['decisionId', 'chosenOptionId'],
      },
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
      parameters: {
        type: 'object',
        properties: {
          decisionId: { type: 'string', description: 'ID of the decision to reject' },
          captainId: { type: 'string', description: 'ID of the Captain rejecting (default: current user)' },
        },
        required: ['decisionId'],
      },
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
      parameters: { type: 'object', properties: {} },
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
      parameters: { type: 'object', properties: {} },
      execute: async (args: Record<string, unknown>) => {
        const messageId = `tool_notify_${Date.now()}`;
        await deps.eventBus.publish({
          messageId,
          correlationId: messageId,
          causationId: null,
          timestamp: new Date(),
          messageType: MessageType.SystemNotification,
          payload: {
            type: 'tool_notification',
            message: args.message as string,
            data: { level: (args.level as string) ?? 'info' },
          },
        });
        return { published: true, messageId };
      },
    },

    // ═══════════════════════════════════════════════════════════
    // Memory Tools (read + write)
    // ═══════════════════════════════════════════════════════════
    {
      name: 'remember',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session ID for scoping this memory' },
          key: { type: 'string', description: 'Key to store the value under' },
          value: { description: 'The value to remember (any JSON-compatible value)' },
          ttlMs: { type: 'integer', description: 'Optional time-to-live in milliseconds' },
        },
        required: ['sessionId', 'key', 'value'],
      },
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
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session ID to recall from' },
          key: { type: 'string', description: 'Specific key to recall, or omit to get all keys' },
        },
        required: ['sessionId'],
      },
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
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query for long-term memory' },
          limit: { type: 'integer', description: 'Maximum number of results (default 20)', default: 20 },
        },
        required: ['query'],
      },
      execute: async (args: Record<string, unknown>) => {
        const query = args.query as string;
        const limit = (args.limit as number) ?? 20;
        let queryEmbedding: number[] | undefined;
        try {
          const embeddings = await deps.generateEmbeddings([query]);
          queryEmbedding = embeddings[0];
        } catch {
          /* fall back to text-only search */
        }
        const results = await deps.longTerm.search(query, limit, queryEmbedding);
        return results.map((r) => ({
          content: r.content,
          timestamp: r.timestamp,
          metadata: r.metadata,
        }));
      },
    },
    {
      name: 'list_memories',
      timeoutMs: 15000,
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Maximum results (default 20, max 100)', default: 20 },
          offset: { type: 'integer', description: 'Pagination offset (default 0)', default: 0 },
          status: { type: 'string', description: "Filter: 'active' (default), 'expired', 'archived', or 'all'" },
        },
        required: [],
      },
      execute: async (args: Record<string, unknown>) => {
        const limit = Math.min((args.limit as number) ?? 20, 100);
        const offset = (args.offset as number) ?? 0;
        const statusFilter = (args.status as string) ?? 'active';
        const all = deps.longTerm.findAll(limit + offset, 0);
        const filtered =
          statusFilter === 'all'
            ? all
            : all.filter((r) => {
                const s = r.metadata.status as string | undefined;
                if (statusFilter === 'active') return !s || (s !== 'expired' && s !== 'archived');
                return s === statusFilter;
              });
        const sliced = filtered.slice(offset, offset + limit);
        return {
          memories: sliced.map((r) => ({
            id: r.id,
            content: r.content.slice(0, 500),
            timestamp: r.timestamp,
            metadata: r.metadata,
          })),
          total: filtered.length,
          hasMore: offset + limit < filtered.length,
        };
      },
    },
    {
      name: 'write_memory',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Memory content to store (minimum 10 characters)' },
          metadata: { type: 'object', description: 'Optional metadata key-value pairs attached to the memory' },
        },
        required: ['content'],
      },
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
    {
      name: 'update_memory',
      parameters: {
        type: 'object',
        properties: {
          memoryId: { type: 'string', description: 'ID of the memory entry to update' },
          status: { type: 'string', description: 'New status value (e.g. "superseded", "archived")' },
          importance: { type: 'number', description: 'Importance score for decay weighting' },
          confidence: { type: 'number', description: 'Confidence score for the stored fact' },
        },
        required: ['memoryId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const memoryId = args.memoryId as string;
        const status = args.status as string | undefined;
        const importance = args.importance as number | undefined;
        const confidence = args.confidence as number | undefined;
        if (!memoryId) return { error: 'memoryId is required' };
        const success = await deps.longTerm.updateMemory(memoryId, {
          status,
          importance,
          confidence,
        });
        return { updated: success, memoryId };
      },
    },
    {
      name: 'delete_memory',
      parameters: {
        type: 'object',
        properties: {
          memoryId: { type: 'string', description: 'ID of the memory entry to delete' },
        },
        required: ['memoryId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const memoryId = args.memoryId as string;
        if (!memoryId) return { error: 'memoryId is required' };
        const success = await deps.longTerm.delete(memoryId);
        return { deleted: success, memoryId };
      },
    },

    // ═══════════════════════════════════════════════════════════
    // Project Tools (read + write)
    // ═══════════════════════════════════════════════════════════
    {
      name: 'get_project_context',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID to retrieve context for' },
          brief: { type: 'string', description: 'Optional Chair brief/description for context' },
        },
        required: ['projectId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const projectId = args.projectId as string;
        const chairBrief = args.brief as string | undefined;
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
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID (defaults to "default")' },
          title: { type: 'string', description: 'Milestone title text' },
        },
        required: ['title'],
      },
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
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID (defaults to "default")' },
          summary: { type: 'string', description: 'Updated project summary text' },
        },
        required: ['summary'],
      },
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
      description: 'List all workflows in a project.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID to filter by (omit for all)' },
        },
      },
      execute: async (_args: Record<string, unknown>) => {
        const workflows = deps.listWorkflows();
        return { workflows };
      },
    },
    {
      name: 'get_workflow',
      description: 'Retrieve a single workflow by ID, including its full definition.',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'string', description: 'ID of the workflow to retrieve' },
        },
        required: ['workflowId'],
      },
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
      description: `Create a new workflow. The definition must contain either:
- steps: array of WorkflowStep objects (declarative format, preferred for simple workflows)
- OR nodes + edges: DAG format (preferred for complex/agentGroup/loop workflows)

Supported node types: start, end, agentGroup, llm, skill, tool, code, workflow, ifElse, loop, parallel, merge, pass, intentClassify, knowledgeBase, approval, human.
You may also include capabilities (files, web, shell, knowledge, evaluation) and cronExpression.`,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID (required)' },
          name: { type: 'string', description: 'Human-readable workflow name' },
          definition: {
            type: 'object',
            description: 'Workflow definition object. Use { steps: [...], capabilities?: {...} } for declarative, or { nodes: [...], edges: [...], capabilities?: {...} } for DAG.',
          },
          cronExpression: { type: 'string', description: 'Optional cron expression for scheduled execution' },
        },
        required: ['projectId', 'name', 'definition'],
      },
      execute: async (args: Record<string, unknown>) => {
        const projectId = args.projectId as string;
        if (!projectId) {
          return { error: 'projectId is required' };
        }
        const name = (args.name as string) ?? 'Untitled Workflow';
        const definition = (args.definition as unknown) ?? { nodes: [], edges: [] };
        const result = deps.createWorkflow({ name, projectId, definition });
        return { created: true, workflowId: result.id, name, projectId };
      },
    },
    {
      name: 'update_workflow',
      description: 'Update an existing workflow name or definition.',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'string', description: 'ID of the workflow to update' },
          name: { type: 'string', description: 'New workflow name' },
          definition: {
            type: 'object',
            description: 'New workflow definition (same format as create_workflow)',
          },
        },
        required: ['workflowId'],
      },
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
      description: 'Execute a workflow by ID immediately.',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'string', description: 'ID of the workflow to run' },
        },
        required: ['workflowId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const workflowId = args.workflowId as string;
        if (!workflowId) return { error: 'workflowId is required' };
        const result = await deps.runWorkflow(workflowId);
        return { executed: true, ...result };
      },
    },
    {
      name: 'delete_workflow',
      description: 'Delete a workflow by ID.',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'string', description: 'ID of the workflow to delete' },
        },
        required: ['workflowId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const workflowId = args.workflowId as string;
        if (!workflowId) return { error: 'workflowId is required' };
        deps.deleteWorkflow(workflowId);
        return { deleted: true, workflowId };
      },
    },
    {
      name: 'get_workflow_run',
      description: 'Retrieve details of a specific workflow run.',
      parameters: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'ID of the run to retrieve' },
        },
        required: ['runId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const runId = args.runId as string;
        if (!runId) return { error: 'runId is required' };
        const run = deps.getWorkflowRun(runId);
        if (!run) return { error: `Run not found: ${runId}` };
        return run;
      },
    },
    {
      name: 'list_workflow_runs',
      description: 'List all runs for a given workflow.',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'string', description: 'ID of the workflow' },
        },
        required: ['workflowId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const workflowId = args.workflowId as string;
        if (!workflowId) return { error: 'workflowId is required' };
        return { runs: deps.listWorkflowRuns(workflowId) };
      },
    },

    // ═══════════════════════════════════════════════════════════
    // Employee Tools
    // ═══════════════════════════════════════════════════════════
    {
      name: 'create_employee',
      parameters: { type: 'object', properties: {} },
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
      parameters: { type: 'object', properties: {} },
      execute: async (_args: Record<string, unknown>) => {
        return deps.listAgents();
      },
    },
    {
      name: 'register_agent',
      parameters: { type: 'object', properties: {} },
      execute: async (args: Record<string, unknown>) => {
        const name = args.name as string;
        const description = (args.description as string) ?? '';
        const systemPrompt = (args.systemPrompt as string) ?? '';
        const modelTier = (args.modelTier as string) || 'default';
        const temperature = (args.temperature as number) ?? 0.3;
        const maxResponseTokens = (args.maxResponseTokens as number) ?? 4000;
        const rawAllowedTools = args.allowedTools;
        if (rawAllowedTools !== undefined && !Array.isArray(rawAllowedTools)) {
          return { error: 'allowedTools must be an array of strings, e.g., ["read_file", "write_file"]. Got: ' + typeof rawAllowedTools };
        }
        const allowedTools = (rawAllowedTools as string[]) ?? [];
        for (let i = 0; i < allowedTools.length; i++) {
          if (typeof allowedTools[i] !== 'string') {
            return { error: `allowedTools[${i}] must be a string. Got: ${typeof allowedTools[i]}` };
          }
        }
        const contextBudget = (args.contextBudget as number) ?? 0.3;

        if (!name) return { error: 'name is required' };
        if (!/^[\w一-鿿\s-]{2,64}$/.test(name)) {
          return {
            error:
              'Invalid agent name. Use 2-64 characters: letters, digits, Chinese, underscores, hyphens, spaces.',
          };
        }
        if (!systemPrompt) return { error: 'systemPrompt is required' };

        return deps.registerAgent({
          name,
          description,
          systemPrompt,
          modelTier,
          temperature,
          maxResponseTokens,
          allowedTools,
          contextBudget,
        });
      },
    },
    {
      name: 'update_agent',
      parameters: { type: 'object', properties: {} },
      execute: async (args: Record<string, unknown>) => {
        const name = args.name as string;
        if (!name) return { error: 'name is required' };
        const updates: Record<string, unknown> = {};
        if (args.description !== undefined) updates.description = args.description;
        if (args.systemPrompt !== undefined) updates.systemPrompt = args.systemPrompt;
        if (args.modelTier !== undefined) updates.modelTier = args.modelTier;
        if (args.temperature !== undefined) updates.temperature = args.temperature;
        if (args.maxResponseTokens !== undefined)
          updates.maxResponseTokens = args.maxResponseTokens;
        if (args.allowedTools !== undefined) updates.allowedTools = args.allowedTools;
        if (args.contextBudget !== undefined) updates.contextBudget = args.contextBudget;
        deps.updateAgent(name, updates);
        return { updated: true, name };
      },
    },
    {
      name: 'delete_agent',
      parameters: { type: 'object', properties: {} },
      execute: async (args: Record<string, unknown>) => {
        const name = args.name as string;
        if (!name) return { error: 'name is required' };
        deps.deleteAgent(name);
        return { deleted: true, name };
      },
    },
    {
      name: 'invoke_agent',
      parameters: { type: 'object', properties: {} },
      execute: async (args: Record<string, unknown>, context) => {
        const agentName = args.agentName as string;
        const message = args.message as string;
        if (!agentName) return { error: 'agentName is required' };
        if (!message) return { error: 'message is required' };
        return deps.invokeAgent(agentName, message, context?.sessionId);
      },
    },

    // ═══════════════════════════════════════════════════════════
    // Project Tools
    // ═══════════════════════════════════════════════════════════
    {
      name: 'set_project_context',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID to set as active context' },
          brief: { type: 'string', description: 'Optional Chair brief describing the current task or focus' },
        },
        required: ['projectId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const projectId = args.projectId as string;
        const chairBrief = args.brief as string | undefined;
        if (!projectId) return { error: 'projectId is required' };
        const result = deps.setProjectContext(projectId);
        if (chairBrief) {
          deps.project.updateSummary(projectId, chairBrief);
        }
        return { activeProject: result };
      },
    },
    {
      name: 'create_project',
      parameters: { type: 'object', properties: {} },
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
      parameters: { type: 'object', properties: {} },
      execute: async (_args: Record<string, unknown>) => {
        return { projects: deps.listProjects() };
      },
    },
    {
      name: 'get_project_context',
      parameters: { type: 'object', properties: {} },
      execute: async (args: Record<string, unknown>) => {
        const projectId = args.projectId as string;
        const chairBrief = args.brief as string | undefined;
        if (!projectId) return { error: 'projectId is required' };
        return { context: deps.getProjectContext(projectId) };
      },
    },

    // ═══════════════════════════════════════════════════════════
    // Status/Health Tools
    // ═══════════════════════════════════════════════════════════
    {
      name: 'get_status',
      parameters: { type: 'object', properties: {} },
      execute: async (_args: Record<string, unknown>) => {
        const metrics = deps.getSystemMetrics();
        return {
          status: 'operational',
          timestamp: new Date().toISOString(),
          toolsAvailable: 42,
          metrics,
        };
      },
    },
    {
      name: 'get_dashboard_stats',
      parameters: { type: 'object', properties: {} },
      execute: async (_args: Record<string, unknown>) => {
        return deps.getDashboardStats();
      },
    },

    {
      name: 'get_memory_stats',
      parameters: { type: 'object', properties: {} },
      execute: async (_args: Record<string, unknown>) => {
        const shortTermCount = deps.shortTerm.size?.() ?? 0;
        const longTermCount = (deps.longTerm as any).size?.() ?? 0;
        return {
          shortTerm: { count: shortTermCount },
          longTerm: { count: longTermCount },
        };
      },
    },

    // ═══════════════════════════════════════════════════════════
    // Task Delegation / Tracking Tools
    // ═══════════════════════════════════════════════════════════
    {
      name: 'delegate_task',
      parameters: { type: 'object', properties: {} },
      execute: async (args: Record<string, unknown>) => {
        const name = args.name as string;
        const agentName = args.agentName as string | undefined;
        const description = args.description as string | undefined;
        if (!name) return { error: 'name is required' };
        const taskId = deps.delegateTask(name, agentName, description);
        return { taskId, name, agentName, status: 'running' };
      },
    },
    {
      name: 'get_task_status',
      parameters: { type: 'object', properties: {} },
      execute: async (args: Record<string, unknown>) => {
        const taskId = args.taskId as string;
        if (!taskId) return { error: 'taskId is required' };
        const task = deps.getTaskStatus(taskId);
        if (!task) return { error: `Task not found: ${taskId}` };
        return task;
      },
    },
    {
      name: 'list_active_tasks',
      parameters: { type: 'object', properties: {} },
      execute: async (_args: Record<string, unknown>) => {
        return { tasks: deps.listActiveTasks() };
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

    // ═══════════════════════════════════════════════════════════
    // System Knowledge Tools
    // ═══════════════════════════════════════════════════════════
    ...createSystemKnowledgeTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Document Tools
    // ═══════════════════════════════════════════════════════════
    ...createDocumentTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Archive Tools
    // ═══════════════════════════════════════════════════════════
    ...createArchiveTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Browser Tools
    // ═══════════════════════════════════════════════════════════
    ...createBrowserTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Communication Tools
    // ═══════════════════════════════════════════════════════════
    ...createCommunicationTools(deps),

    // ═══════════════════════════════════════════════════════════
    // System Tools
    // ═══════════════════════════════════════════════════════════
    ...createSystemTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Review Tools (interactive mode)
    // ═══════════════════════════════════════════════════════════
    {
      name: 'present_for_review',
      description:
        'Present your completed blueprint for user review. Call this after finishing the design phase. The user will review and provide feedback before deployment. Do NOT deploy until the user approves.',
      parameters: {
        type: 'object',
        properties: {
          blueprint: { type: 'object', description: 'The complete blueprint JSON with meta, agents, workflow, harness, and authorization fields' },
          summary: { type: 'string', description: 'A human-readable summary of what was designed and why' },
        },
        required: ['blueprint', 'summary'],
      },
      execute: async (args: Record<string, unknown>) => {
        const blueprint = args.blueprint;
        const summary = (args.summary as string) ?? 'Blueprint ready for review.';
        return JSON.stringify({
          status: 'presented_for_review',
          message: `Blueprint presented for review. ${summary}\n\nPlease review and respond with feedback (e.g., "change X", "add Y"), or "approved" to deploy, or "cancel" to discard.`,
          blueprint,
        });
      },
    },
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
  mcpListTools: () => {
    serverName: string;
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }[],
): ToolExecutor {
  for (const tool of mcpListTools()) {
    const fullName = `mcp__${tool.name}`;
    executor.register({
      name: fullName,
      description: tool.description,
      parameters: tool.inputSchema,
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
    parameters: {
      type: 'object',
      properties: {
        skill: { type: 'string', description: 'Name of the skill to invoke' },
        arguments: { type: 'string', description: 'Arguments to pass to the skill (optional)' },
      },
      required: ['skill'],
    },
    execute: async (args: Record<string, unknown>) => {
      const skillName = args.skill as string;
      if (!skillName) return { error: 'skill name is required' };
      const skill = registry.load(skillName);
      if (!skill) return { error: `Skill not found: ${skillName}` };
      const result = await registry.executeSkill(skill, args);
      return result;
    },
  });

  // Register update_skill for in-place skill modification
  executor.register({
    name: 'update_skill',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the skill to update' },
        description: { type: 'string', description: 'Updated description' },
        promptTemplate: { type: 'string', description: 'Updated instruction body (Markdown)' },
        kind: { type: 'string', description: 'Updated kind: tool, prompt, or composite' },
      },
      required: ['name'],
    },
    execute: async (args: Record<string, unknown>) => {
      const skillName = args.name as string;
      if (!skillName) return { error: 'name is required' };
      const existing = registry.load(skillName);
      if (!existing) return { error: `Skill not found: ${skillName}` };
      const updated = {
        ...existing,
        description: (args.description as string) ?? existing.description,
        promptTemplate: (args.promptTemplate as string) ?? existing.promptTemplate,
        kind: (args.kind as 'tool' | 'prompt' | 'composite') ?? existing.kind,
        version: existing.version + 1,
      };
      registry.register(updated);
      return { updated: true, name: skillName, version: updated.version };
    },
  });

  return executor;
}
