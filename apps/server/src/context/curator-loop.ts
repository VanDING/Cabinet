/**
 * Curator AgentLoop factory — creates the AgentLoop used by all curator background tasks.
 * Extracted from curator.ts (300+ lines).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from '@cabinet/storage';
import type { LLMGateway, CostTracker } from '@cabinet/gateway';
import { AgentLoop, SafetyChecker, CheckpointManager } from '@cabinet/agent';
import type { ToolDependencies, AgentRoleRegistry } from '@cabinet/agent';
import { createStandardToolExecutor } from '../agent-factory.js';
import { createFileCapabilities, createKnowledgeCapabilities } from '../capabilities.js';
import type {
  ShortTermMemory, LongTermMemory, EntityMemory, ProjectMemory,
} from '@cabinet/memory';
import type { DecisionService } from '@cabinet/decision';
import type { DecisionRepository } from '@cabinet/storage';
import type { EventBus } from '@cabinet/events';
import type { SessionManager } from '@cabinet/secretary';
import { DEFAULT_CAPTAIN_ID, DelegationTier } from '@cabinet/types';

const RAG_CURATOR_TOP_K = 10;

export interface CuratorLoopDeps {
  db: Database;
  /** Mutable ref — checked at call time */
  gateway: LLMGateway | null;
  agentRegistry: AgentRoleRegistry;
  logger: { info(msg: string, meta?: Record<string, unknown>): void; warn(msg: string, meta?: Record<string, unknown>): void };
  sessionManager: SessionManager;
  shortTerm: ShortTermMemory;
  longTerm: LongTermMemory;
  entity: EntityMemory;
  project: ProjectMemory;
  decisionRepo: DecisionRepository;
  decisionService: DecisionService;
  eventBus: EventBus;
  currentTier: DelegationTier;
  costTracker: CostTracker;
  /** Full ServerContext — accessed at runtime only */
  ctx: Record<string, unknown>;
}

export function createCuratorLoop(deps: CuratorLoopDeps): AgentLoop | null {
  const gateway = deps.gateway;
  if (!gateway) return null;

  const role = deps.agentRegistry.get('curator');
  if (!role) return null;

  const capCtx = {
    db: deps.ctx.db as Database,
    gateway: deps.ctx.gateway as LLMGateway,
    logger: deps.ctx.logger,
    taskScheduler: deps.ctx.taskScheduler,
    workflowRepo: deps.ctx.workflowRepo,
    projectRepo: deps.ctx.projectRepo,
  } as Parameters<typeof createFileCapabilities>[0];
  const fileCaps = createFileCapabilities(capCtx);
  const knowledgeCaps = createKnowledgeCapabilities(capCtx);

  const curatorDeps: ToolDependencies = {
    decisionStore: deps.decisionRepo,
    eventBus: deps.eventBus,
    shortTerm: deps.shortTerm,
    longTerm: deps.longTerm,
    entity: deps.entity,
    project: deps.project,
    createDecision(input) {
      const id = `dec_${Date.now()}`;
      return deps.decisionService.create({
        id, projectId: input.projectId, type: input.type,
        title: input.title, description: input.description,
        options: input.options, classification: input.classification,
        captainId: input.captainId,
      }) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    },
    approveDecision: (decisionId, captainId, chosenOptionId) =>
      deps.decisionService.approve(decisionId, captainId, chosenOptionId),
    rejectDecision: (decisionId, captainId) => deps.decisionService.reject(decisionId, captainId),
    listWorkflows: () => [],
    getWorkflow: () => undefined,
    createWorkflow: () => ({ id: '' }),
    updateWorkflow: () => {},
    deleteWorkflow: () => {},
    runWorkflow: async () => ({ runId: '', status: 'not_implemented' }),
    startMeeting: async (topic) => ({ meetingId: '', topic, synthesis: '', perspectives: [] }),
    writeLongTermMemory: async (content, metadata) => {
      let embedding: number[] | undefined;
      if (gateway) {
        try {
          const result = await gateway.generateEmbeddings({ texts: [content] });
          embedding = result.embeddings[0];
        } catch { /* store without embedding */ }
      }
      return deps.longTerm.store({ content, metadata: metadata ?? {}, embedding, timestamp: new Date() });
    },
    createEmployee: () => {},
    registerAgent: (input) => {
      deps.agentRegistry.register({
        type: 'custom' as const, name: input.name, description: input.description,
        modules: { identity: input.systemPrompt },
        modelTier: (input as any).modelTier ?? 'default', // eslint-disable-line @typescript-eslint/no-explicit-any
        temperature: input.temperature, maxResponseTokens: input.maxResponseTokens,
        allowedTools: input.allowedTools, contextBudget: input.contextBudget,
      });
      return { type: 'custom', name: input.name };
    },
    updateAgent: () => {},
    deleteAgent: () => {},
    invokeAgent: async () => { throw new Error('Agent invocation not available for Curator background task'); },
    listAgents: () => deps.agentRegistry.list().map((r) => ({
      type: r.type, name: r.name, description: r.description, builtIn: r.type !== 'custom',
    })),
    setProjectContext: (pid) => ({ id: pid, name: pid }),
    createProject: (input) => ({ id: `proj_${Date.now()}`, name: input.name }),
    listProjects: () => [],
    getProjectContext: (pid) => { const p = deps.project.get(pid); return p ? { id: pid, name: p.summary } : null; },
    getDashboardStats: () => ({
      pendingDecisions: 0, activeWorkflows: 0, activeProjects: 0, todayCost: 0,
      totalLLMCalls: 0, totalTokens: 0, totalDecisions: 0, errors: 0, recentEvents: [],
    }),
    delegateTask: () => 'task_stub',
    getTaskStatus: () => null,
    listActiveTasks: () => [],
    getDecisionAudit: () => [],
    getSystemMetrics: () => ({ totalLLMCalls: 0, totalTokens: 0, totalDecisions: 0, errors: 0 }),
    getWorkflowRun: () => null,
    listWorkflowRuns: () => [],
    readFile: async (path, offset, limit) => {
      try {
        const content = readFileSync(path, 'utf-8');
        const lines = content.split('\n');
        const start = offset ?? 0;
        const end = limit ? start + limit : lines.length;
        return { content: lines.slice(start, end).join('\n'), size: content.length, encoding: 'utf-8' };
      } catch (e) { throw new Error(String(e)); }
    },
    writeFile: async () => { throw new Error('File write not available'); },
    editFile: async () => { throw new Error('File edit not available'); },
    applyPatch: async () => { throw new Error('Patch not available'); },
    moveFile: async () => { throw new Error('File move not available'); },
    copyFile: async () => { throw new Error('File copy not available'); },
    makeDirectory: async () => { throw new Error('Directory creation not available'); },
    fileInfo: async () => { throw new Error('File info not available'); },
    listDirectory: async (path) => {
      try {
        const entries = readdirSync(path, { withFileTypes: true });
        return entries.map((e) => ({ name: e.name, path: join(path, e.name), isDir: e.isDirectory() }));
      } catch (e) { throw new Error(String(e)); }
    },
    searchFiles: fileCaps.searchFiles,
    searchContent: fileCaps.searchContent,
    deleteFile: async () => { throw new Error('File deletion not available'); },
    recentFiles: async () => [],
    watchFile: async () => ({ changed: false, size: 0 }),
    indexProject: async () => ({ indexed: 0, skipped: 0, errors: 1 }),
    webFetch: async (url) => {
      try {
        const res = await fetch(url);
        const text = await res.text();
        const contentType = res.headers.get('content-type') ?? 'text/plain';
        const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
        return { content: text, status: res.status, contentType, title: titleMatch?.[1]?.trim() };
      } catch (e) { throw new Error(String(e)); }
    },
    httpRequest: async () => { throw new Error('HTTP not available'); },
    execCommand: async () => { throw new Error('Shell not available'); },
    scheduleTask: async () => { throw new Error('Scheduler not available'); },
    listScheduledTasks: async () => [],
    cancelScheduledTask: async () => { throw new Error('Scheduler not available'); },
    indexDocument: async () => { throw new Error('Indexing not available'); },
    searchDocuments: knowledgeCaps.searchDocuments,
    clearDocumentIndex: async () => { throw new Error('Index management not available'); },
    evaluateOutput: async () => ({ overallScore: 0, dimensions: {}, feedback: 'Evaluation not available', evaluatorModel: 'none' }),
    workspaceSymbols: async () => ({ available: false, error: 'LSP not available for Curator background task' }),
    goToDefinition: async () => ({ available: false, error: 'LSP not available for Curator background task' }),
    findReferences: async () => ({ available: false, error: 'LSP not available for Curator background task' }),
    diagnostics: async () => ({ available: false, error: 'LSP not available for Curator background task' }),
    querySystemKnowledge: async (query, limit) => {
      const repo = deps.ctx.systemKnowledgeRepo as { search(q: string, k: number): Promise<Array<{ topic: string; content: string; category: string }>> };
      return repo.search(query, limit ?? 5);
    },
    getSystemKnowledge: async (topic) => {
      const repo = deps.ctx.systemKnowledgeRepo as { findByTopic(t: string): { topic: string; content: string; category: string } | null };
      return repo.findByTopic(topic);
    },
    readPdf: async () => { throw new Error('PDF read not available for Curator background task'); },
    readDocx: async () => { throw new Error('DOCX read not available for Curator background task'); },
    readXlsx: async () => { throw new Error('XLSX read not available for Curator background task'); },
    readPptx: async () => { throw new Error('PPTX read not available for Curator background task'); },
    listZip: async () => { throw new Error('ZIP list not available for Curator background task'); },
    extractZip: async () => { throw new Error('ZIP extract not available for Curator background task'); },
    browserNavigate: async () => { throw new Error('Browser not available for Curator background task'); },
    browserClick: async () => { throw new Error('Browser not available for Curator background task'); },
    browserType: async () => { throw new Error('Browser not available for Curator background task'); },
    browserRead: async () => { throw new Error('Browser not available for Curator background task'); },
    browserScreenshot: async () => { throw new Error('Browser not available for Curator background task'); },
    browserEvaluate: async () => { throw new Error('Browser not available for Curator background task'); },
    fetchRss: async () => { throw new Error('RSS fetch not available for Curator background task'); },
    sendEmail: async () => { throw new Error('Email not available for Curator background task'); },
    readClipboard: async () => { throw new Error('Clipboard not available for Curator background task'); },
    writeClipboard: async () => { throw new Error('Clipboard not available for Curator background task'); },
    sendNotification: async () => { throw new Error('Notification not available for Curator background task'); },
    startProcess: async () => { throw new Error('Process start not available for Curator background task'); },
    killProcess: async () => { throw new Error('Process kill not available for Curator background task'); },
    showOpenDialog: async () => { throw new Error('Dialog not available for Curator background task'); },
    generateEmbeddings: async (texts) => {
      if (!gateway) throw new Error('No LLM gateway available');
      const result = await gateway.generateEmbeddings({ texts });
      return result.embeddings;
    },
  };

  const executor = createStandardToolExecutor(deps.ctx as unknown as Parameters<typeof createStandardToolExecutor>[0], curatorDeps, role.allowedTools);
  const checkpointManager = new CheckpointManager(deps.db);

  return new AgentLoop({
    costTracker: deps.costTracker,
    gateway,
    toolExecutor: executor,
    safetyChecker: new SafetyChecker(deps.currentTier),
    checkpointManager,
    memoryProvider: {
      getShortTerm: async (sid) => {
        const items: { role: 'user' | 'assistant'; content: string }[] = [];
        const session = deps.sessionManager.get(sid);
        if (session && session.messages.length > 0) {
          for (const m of session.messages.slice(-20)) {
            items.push({ role: m.role, content: m.content });
          }
        }
        const kv = deps.shortTerm.getAll(sid);
        for (const [k, v] of Object.entries(kv)) {
          if (typeof v === 'string' && v.length > 0) {
            items.push({ role: 'user' as const, content: `[${k}]: ${v}` });
          }
        }
        return items;
      },
      getProjectContext: async (pid) => {
        const p = deps.project.get(pid);
        if (!p) return `Project: ${pid}`;
        return `Project: ${p.summary}\nGoals: ${p.goals.join(', ')}`;
      },
      getEntityPreferences: async (cid) => {
        const prefs = deps.entity.getPreferences(cid);
        return prefs?.preferences ?? {};
      },
      searchLongTerm: async (query, _pid) => {
        let embedding: number[] | undefined;
        try {
          if (gateway) {
            const er = await gateway.generateEmbeddings({ texts: [query] });
            embedding = er.embeddings[0];
          }
        } catch { /* fall back to text search */ }
        const results = await deps.longTerm.search(query, RAG_CURATOR_TOP_K, embedding);
        return results.map((r) => `[Memory] ${r.content}`);
      },
      getRecentInsights: async (count) => {
        const results = await deps.longTerm.search('', count * 3);
        return results
          .filter((r) =>
            r.metadata.type === 'insight' || r.metadata.type === 'harness_insight' || r.metadata.type === 'subconscious_insight')
          .slice(0, count)
          .map((r) => ({
            text: r.content,
            relevance: (r.metadata.relevance as number) ?? 0.5,
            source: (r.metadata.source as string) ?? 'unknown',
          }));
      },
    },
    sessionId: `curator_bg_${Date.now()}`,
    projectId: 'default',
    captainId: DEFAULT_CAPTAIN_ID,
    roleModules: role.modules,
    model: ((gateway as any)?.resolveModelString?.(role.modelTier) as string) ?? role.modelTier, // eslint-disable-line @typescript-eslint/no-explicit-any
    maxSteps: role.maxSteps ?? 50,
    maxResponseTokens: role.maxResponseTokens,
    temperature: role.temperature,
    contextBudget: role.contextBudget,
  });
}
