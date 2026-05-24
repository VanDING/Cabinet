import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { decryptApiKey } from './crypto.js';
import { broadcast } from './ws/handler.js';
import {
  createConnection,
  runMigrations,
  DecisionRepository,
  ProjectRepository,
  EventLogRepository,
  WorkflowRepository,
  AuditLogRepository,
  DeliverableRepository,
  ApiKeyRepository,
  AgentRoleRepository,
  SkillRepository,
  EmployeeRepository,
  ProjectContextRepository,
  MetricRepository,
  CostHistoryRepository,
  SessionMetricsRepository,
  SettingsRepository,
  ScheduledTaskRepository,
  MetricsCollector,
  BackupManager,
  getLogger,
  CABINET_DIR,
  ensureCabinetDir,
} from '@cabinet/storage';
import type { Database } from '@cabinet/storage';
import {
  DecisionService,
  DecisionStateMachine,
  LevelClassifier,
  AuditLogger,
  EscalationService,
} from '@cabinet/decision';
import { AISDKAdapter, CostTracker, BudgetGuard } from '@cabinet/gateway';
import {
  ShortTermMemory,
  LongTermMemory,
  EntityMemory,
  ProjectMemory,
  ConsolidationService,
  KnowledgeGraph,
  MemoryDecayService,
} from '@cabinet/memory';
import { MemoryEventBus } from '@cabinet/events';
import { SessionManager } from '@cabinet/secretary';
import { config } from './config.js';
import type { LLMGateway, ModelMapping, ProviderEntry, ModelTier } from '@cabinet/gateway';
import { DelegationTier, DEFAULT_DELEGATION_TIER, DEFAULT_CAPTAIN_ID, DEFAULT_CAPTAIN_NAME, MessageType, DAILY_BUDGET_USD } from '@cabinet/types';
import {
  AgentRoleRegistry,
  CURATOR_ROLE,
  SkillRegistry,
  importSkillFromMarkdown,
  AgentLoop,
  ToolExecutor,
  SafetyChecker,
  CheckpointManager,
  registerCabinetTools,
  registerSkillTools,
  registerMCPTools,
} from '@cabinet/agent';
import type { ToolDependencies } from '@cabinet/agent';
import { SkillExtractor } from '@cabinet/agent';
import { MCPManager } from './mcp/mcp-manager.js';
import { TaskScheduler } from './scheduler.js';
import { startApprovalPolling, stopApprovalPolling } from './routes/workflows.js';
import {
  ObservabilityCollector,
  PreferenceLearner,
  AutoAdjuster,
  QualityResponseService,
  SubconsciousLoop,
} from '@cabinet/harness';
import type {
  PreferenceAnalysisCallback,
  AdjustmentNotifyCallback,
  ReconsolidationCallback,
} from '@cabinet/harness';

const RAG_CURATOR_TOP_K = 10;

// Redefined locally to avoid circular dependency on @cabinet/secretary internals
const SESSION_KEEP_OLDEST = 30;
const SESSION_KEEP_RECENT = 30;

export interface ServerContext {
  db: Database;
  // Repos
  decisionRepo: DecisionRepository;
  projectRepo: ProjectRepository;
  eventRepo: EventLogRepository;
  workflowRepo: WorkflowRepository;
  auditLogRepo: AuditLogRepository;
  deliverableRepo: DeliverableRepository;
  apiKeyRepo: ApiKeyRepository;
  agentRoleRepo: AgentRoleRepository;
  skillRepo: SkillRepository;
  employeeRepo: EmployeeRepository;
  projectContextRepo: ProjectContextRepository;
  metricRepo: MetricRepository;
  costHistoryRepo: CostHistoryRepository;
  sessionMetricsRepo: SessionMetricsRepository;
  settingsRepo: SettingsRepository;
  // Decision service
  decisionService: DecisionService;
  // Memory
  shortTerm: ShortTermMemory;
  longTerm: LongTermMemory;
  entity: EntityMemory;
  project: ProjectMemory;
  // Gateway
  gateway: LLMGateway | null;
  refreshGateway: () => void;
  costTracker: CostTracker;
  budgetGuard: BudgetGuard;
  // Session
  sessionManager: SessionManager;
  // File tracking (per-session, auto-populated by tool callbacks)
  fileTracker: FileAccessTracker;
  // Permissions
  delegationTier: DelegationTier;
  // Agent registry (shared across all requests — custom roles persist here)
  agentRegistry: AgentRoleRegistry;
  // Skill registry (shared — loaded from DB on startup)
  skillRegistry: import('@cabinet/agent').SkillRegistry;
  mcpManager: import('./mcp/mcp-manager.js').MCPManager;
  // Scheduler
  taskScheduler: TaskScheduler;
  // Feedback loop
  observability: ObservabilityCollector;
  autoAdjuster: AutoAdjuster;
  // Skill extraction
  skillExtractor: SkillExtractor;
  // Knowledge graph
  knowledgeGraph: KnowledgeGraph;
  // Memory decay
  memoryDecay: MemoryDecayService;
  // Subconscious loop
  subconsciousLoop: SubconsciousLoop;
  // Infrastructure
  eventBus: MemoryEventBus;
  metrics: MetricsCollector;
  logger: ReturnType<typeof getLogger>;
  backupManager: BackupManager | null;
  /** Clean up all timers, close DB, stop backup. Call on process exit. */
  shutdown: () => void;
}

export interface RecentFileEntry {
  path: string;
  operation: 'read' | 'write' | 'edit' | 'delete' | 'move' | 'copy';
  timestamp: string;
}

export class FileAccessTracker {
  private entries = new Map<string, RecentFileEntry[]>();
  private maxEntries = 100;

  record(sessionId: string, path: string, operation: RecentFileEntry['operation']): void {
    if (!this.entries.has(sessionId)) {
      this.entries.set(sessionId, []);
    }
    const list = this.entries.get(sessionId)!;
    list.push({ path, operation, timestamp: new Date().toISOString() });
    if (list.length > this.maxEntries) {
      list.splice(0, list.length - this.maxEntries);
    }
  }

  getRecent(sessionId: string, limit = 20): RecentFileEntry[] {
    const list = this.entries.get(sessionId);
    if (!list) return [];
    return list.slice(-limit).reverse();
  }

  clear(sessionId: string): void {
    this.entries.delete(sessionId);
  }
}

let ctx: ServerContext | null = null;
let currentTier: DelegationTier = DEFAULT_DELEGATION_TIER;
const tierChangeListeners: Array<(tier: DelegationTier) => void> = [];

export function getCurrentTier(): DelegationTier {
  return currentTier;
}

export function setCurrentTier(tier: DelegationTier): void {
  currentTier = tier;
  if (ctx) {
    ctx.delegationTier = tier;
  }
  for (const listener of tierChangeListeners) {
    try { listener(tier); } catch { /* non-fatal */ }
  }
}

/** Register a callback invoked whenever the delegation tier changes. */
export function onTierChange(fn: (tier: DelegationTier) => void): void {
  tierChangeListeners.push(fn);
}

export function getServerContext(): ServerContext {
  if (ctx) return ctx;

  const logger = getLogger('server');

  // Database — use ~/.cabinet/ (cross-platform user data directory)
  const dataDir = ensureCabinetDir();
  const dbPath = join(dataDir, 'cabinet.db');
  const dbExists = require('node:fs').existsSync(dbPath);

  let db: Database;
  let dbMode: 'file' | 'memory' = 'file';
  try {
    db = createConnection(dbPath);
    runMigrations(db);
    logger.info(`SQLite database initialized (${dbExists ? 'existing' : 'new'})`, { path: dbPath });
    // Write a startup marker so we can diagnose persistence issues
    try {
      require('node:fs').writeFileSync(
        join(dataDir, 'server-startup.log'),
        `${new Date().toISOString()} | DB: file | path: ${dbPath} | existed: ${dbExists}\n`,
      );
    } catch { /* non-fatal */ }
  } catch (e) {
    logger.error('Failed to initialize file-based SQLite', { error: String(e), path: dbPath });
    // Write diagnostic info before falling back
    try {
      require('node:fs').appendFileSync(
        join(dataDir, 'server-startup.log'),
        `${new Date().toISOString()} | DB: FAILED | path: ${dbPath} | error: ${String(e)}\n`,
      );
    } catch { /* non-fatal */ }
    try {
      db = createConnection(':memory:');
      runMigrations(db);
      dbMode = 'memory';
      logger.warn('Falling back to in-memory database — data will NOT persist across restarts');
    } catch (e2) {
      logger.error('SQLite completely unavailable — running without persistence', {
        error: String(e2),
      });
      db = createConnection(':memory:');
      dbMode = 'memory';
    }
  }

  // Repositories
  const decisionRepo = new DecisionRepository(db);
  const projectRepo = new ProjectRepository(db);
  const eventRepo = new EventLogRepository(db);
  const workflowRepo = new WorkflowRepository(db);
  const auditLogRepo = new AuditLogRepository(db);
  const deliverableRepo = new DeliverableRepository(db);
  const apiKeyRepo = new ApiKeyRepository(db);
  const agentRoleRepo = new AgentRoleRepository(db);
  const skillRepo = new SkillRepository(db);
  const employeeRepo = new EmployeeRepository(db);
  const projectContextRepo = new ProjectContextRepository(db);
  const metricRepo = new MetricRepository(db);
  const costHistoryRepo = new CostHistoryRepository(db);
  const sessionMetricsRepo = new SessionMetricsRepository(db);
  const settingsRepo = new SettingsRepository(db);

  // Decision service with preference learning
  const stateMachine = new DecisionStateMachine();
  const classifier = new LevelClassifier();
  const auditLog = new AuditLogger(db);
  const eventBus = new MemoryEventBus();
  eventBus.deadLetterQueue.setDb(db);
  const escalation = new EscalationService(eventBus);

  // Deferred Curator trigger (createCuratorLoop is defined later, after gateway is ready)
  let _triggerCuratorDecisionUpdate: ((decisionId: string, action: string, title: string, chosenOptionId: string | undefined, captainId: string | undefined) => void) | null = null;
  function triggerCuratorPreferenceUpdate(decisionId: string, action: string, title: string, chosenOptionId: string | undefined, captainId: string | undefined): void {
    if (_triggerCuratorDecisionUpdate) {
      _triggerCuratorDecisionUpdate(decisionId, action, title, chosenOptionId, captainId);
    }
  }

  // Decision resolved callback: preference learning + workflow resumption
  const decisionService = new DecisionService(
    stateMachine,
    classifier,
    auditLog,
    escalation,
    decisionRepo,
    (decisionId, action, title, chosenOptionId, captainId) => {
      try {
        const cid = captainId ?? DEFAULT_CAPTAIN_ID;

        // ── Workflow resumption ──
        const wfRows = auditLogRepo.findByEntity('workflow_approval', decisionId, { limit: 1 });
        const wfRow = wfRows[0];

        if (wfRow) {
          try {
            const wfData = JSON.parse(wfRow.changes ?? '{}');
            const wfId = wfData.workflowId as string;
            if (wfId) {
              if (action === 'approved' && chosenOptionId === 'approve_continue') {
                workflowRepo.updateStatus(wfId, 'completed');
                auditLogRepo.insert('workflow_approval', decisionId, 'approved', 'system', { ...wfData, status: 'approved', decisionId });
                logger.info('Workflow approved via decision', { workflowId: wfId, decisionId });
              } else {
                workflowRepo.updateStatus(wfId, 'failed');
                auditLogRepo.insert('workflow_approval', decisionId, 'terminated', 'system', { ...wfData, status: 'terminated', decisionId });
                logger.info('Workflow terminated via decision', { workflowId: wfId, decisionId });
              }
            }
          } catch (e: any) {
            logger.warn('Workflow resumption failed', { error: e.message, decisionId });
          }
        }

        // ── Preference tracking ──
        const existing = entity.getPreferences(cid);
        const existingPrefs = existing?.preferences ?? {};
        const history = (existingPrefs.decisionHistory as any[]) ?? [];

        history.push({
          title,
          action,
          chosenOptionId: chosenOptionId ?? null,
          timestamp: new Date().toISOString(),
        });

        const trimmed = history.slice(-50);

        const approvals = trimmed.filter((h: any) => h.action === 'approved').length;
        const total = trimmed.length;
        const approvalRate = total > 0 ? approvals / total : 0;

        entity.setPreferences(cid, existing?.name ?? DEFAULT_CAPTAIN_NAME, {
          ...existingPrefs,
          decisionHistory: trimmed,
          decisionStats: {
            total,
            approved: approvals,
            rejected: total - approvals,
            approvalRate: Math.round(approvalRate * 100) / 100,
          },
        });

        // Trigger semantic preference analysis (throttled internally)
        preferenceLearner.learnFromDecisions(cid).catch(() => {});

        // Trigger Curator preference update (fire-and-forget)
        triggerCuratorPreferenceUpdate(decisionId, action, title, chosenOptionId, captainId);
      } catch (e: any) {
        logger.warn('Preference learning failed', { error: e.message });
      }
    },
    getCurrentTier,
  );

  // Memory (shared DB for long-term)
  const shortTerm = new ShortTermMemory(db, 1000);
  const longTerm = new LongTermMemory(db);
  const entity = new EntityMemory(db);
  const project = new ProjectMemory(db);

  // Gateway + Cost
  costHistoryRepo.ensureTable();
  const costTracker = new CostTracker({
    persist: (entry) => {
      costHistoryRepo.insert(entry.model, entry.promptTokens, entry.completionTokens, entry.costUsd);
    },
  });
  // Restore today's entries so daily/weekly/monthly budgets work after restart
  try {
    const recentRows = costHistoryRepo.findSince(31);
    if (recentRows.length > 0) {
      costTracker.restore(
        recentRows.map((r) => ({
          timestamp: new Date(r.timestamp),
          model: r.model,
          promptTokens: r.prompt_tokens,
          completionTokens: r.completion_tokens,
          costUsd: r.cost_usd,
        })),
      );
      logger.info('Cost history restored', { entries: recentRows.length });
    }
  } catch (e) {
    logger.warn('Failed to restore cost history', { error: String(e) });
  }
  const budgetGuard = new BudgetGuard(costTracker);

  // Provider configs & model mapping — must be declared before buildGateway()
  // because buildGateway() is called immediately below and references these.
  let modelMapping: ModelMapping = {};
  let providerConfigsFromSettings: Record<string, ProviderEntry> = {};

  // Tier → model mapping per provider. Picks the best available model
  // from the user's configured API keys instead of hardcoding Claude.
  const PROVIDER_TIER_MAP: Record<string, Record<string, string>> = {
    anthropic: { deep_reasoning: 'anthropic/claude-opus-4-7', default: 'anthropic/claude-sonnet-4-6', fast_execution: 'anthropic/claude-haiku-4-5' },
    openai:    { deep_reasoning: 'openai/gpt-4o',             default: 'openai/gpt-4o',              fast_execution: 'openai/gpt-4o-mini' },
    google:    { deep_reasoning: 'google/gemini-2.5-pro',     default: 'google/gemini-2.5-pro',      fast_execution: 'google/gemini-2.5-flash' },
    deepseek:  { deep_reasoning: 'deepseek/deepseek-v4-pro',  default: 'deepseek/deepseek-v4-pro',   fast_execution: 'deepseek/deepseek-v4-flash' },
    qwen:      { deep_reasoning: 'qwen/qwen-max',             default: 'qwen/qwen-plus',             fast_execution: 'qwen/qwen-turbo' },
    moonshot:  { deep_reasoning: 'moonshot/moonshot-v1-128k', default: 'moonshot/moonshot-v1-32k',   fast_execution: 'moonshot/moonshot-v1-8k' },
    zhipu:     { deep_reasoning: 'zhipu/glm-4',               default: 'zhipu/glm-4',                fast_execution: 'zhipu/glm-4-flash' },
    baichuan:  { deep_reasoning: 'baichuan/baichuan4',        default: 'baichuan/baichuan4',         fast_execution: 'baichuan/baichuan3-turbo' },
  };
  const PROVIDER_PREFERENCE = ['anthropic', 'openai', 'google', 'deepseek', 'qwen', 'moonshot', 'zhipu', 'baichuan'];
  const FALLBACK_TIER_MAP = PROVIDER_TIER_MAP.anthropic; // when no keys are configured at all

  function buildDefaultModelMapping(providers: Record<string, unknown>): ModelMapping {
    const primary = PROVIDER_PREFERENCE.find((p) => providers[p] != null);
    if (!primary) return { ...FALLBACK_TIER_MAP };
    return { ...PROVIDER_TIER_MAP[primary] ?? FALLBACK_TIER_MAP };
  }

  // Gateway — built from .env + database
  const buildGateway = (): LLMGateway | null => {
    const providerConfigs: Record<string, { apiKey: string; baseUrl?: string }> = {};

    if (config.anthropicApiKey) providerConfigs.anthropic = { apiKey: config.anthropicApiKey };
    if (config.openaiApiKey) providerConfigs.openai = { apiKey: config.openaiApiKey };
    if (config.deepseekApiKey) providerConfigs.deepseek = { apiKey: config.deepseekApiKey };
    if (config.qwenApiKey) providerConfigs.qwen = { apiKey: config.qwenApiKey };
    if (config.moonshotApiKey) providerConfigs.moonshot = { apiKey: config.moonshotApiKey };
    if (config.zhipuApiKey) providerConfigs.zhipu = { apiKey: config.zhipuApiKey };
    if (config.baichuanApiKey) providerConfigs.baichuan = { apiKey: config.baichuanApiKey };

    const mpw = config.masterPassword;
    try {
      const apiKeys = apiKeyRepo.findAll();
      for (const row of apiKeys) {
        try {
          const decrypted = decryptApiKey(row.encrypted_key, mpw);
          providerConfigs[row.provider] = { apiKey: decrypted, baseUrl: row.base_url ?? undefined };
        } catch {
          /* skip corrupted key row */
        }
      }
    } catch {
      /* API keys table not available */
    }

    // Merge settings.json providers on top of env-based config
    for (const [name, entry] of Object.entries(providerConfigsFromSettings)) {
      if (entry?.apiKey) {
        providerConfigs[name] = { apiKey: entry.apiKey, baseUrl: entry.baseUrl };
      }
    }

    if (Object.keys(providerConfigs).length > 0) {
      // Use user-configured modelMapping if set; otherwise auto-detect from available providers
      const effectiveMapping = Object.keys(modelMapping).length > 0
        ? modelMapping
        : buildDefaultModelMapping(providerConfigs);
      return new AISDKAdapter(providerConfigs as any, effectiveMapping);
    }
    return null;
  };

  let gateway: LLMGateway | null = buildGateway();
  if (gateway) {
    logger.info('LLM Gateway initialized');
  } else {
    logger.warn('No API keys configured — add keys in Settings, then refresh');
  }

  // Called by settings route after add/delete key
  const refreshGateway = () => {
    const gw = buildGateway();
    if (gw) {
      // Update both the local var and the ctx property (ctx may not be assigned yet on first call)
      gateway = gw;
      if (ctx) (ctx as any).gateway = gw;
      logger.info('LLM Gateway refreshed');
    }
  };

  // Session
  const sessionManager = new SessionManager();

  // Wire Curator lifecycle callbacks (fired asynchronously, best-effort)
  sessionManager.onSessionClose((session) => {
    if (gateway && session.messages.length > 0) {
      const messages = session.messages.map((m) => `${m.role}: ${m.content}`).join('\n');
      if (messages.length > 200) {
        enqueueCuratorTask(
          () => runCuratorConsolidation(session.id, messages),
          'consolidation',
        ).catch((e) =>
          logger.warn('Curator on-close consolidation failed', { error: (e as Error).message }),
        );
      }
    }
  });

  sessionManager.onSessionCreate((session) => {
    if (gateway) {
      enqueueCuratorTask(
        () => runCuratorBrief(session.id),
        'brief',
      ).catch((e) =>
        logger.warn('Curator on-create brief failed', { error: (e as Error).message }),
      );
    }
  });

  // Metrics
  const metrics = new MetricsCollector({ repo: metricRepo });
  metrics.startPeriodicFlush();

  // Backup (to ~/.cabinet/backups)
  let backupManager: BackupManager | null = null;
  try {
    backupManager = new BackupManager({
      dbPath,
      backupDir: join(dataDir, 'backups'),
      intervalMinutes: 60,
      keepCount: 7,
      liveConnection: db,
    });
    backupManager.startAutoBackup();
    // Daily database maintenance (VACUUM) — runs 1 hour after startup, then every 24h
    setTimeout(() => {
      backupManager!.runMaintenance();
      setInterval(() => backupManager!.runMaintenance(), 24 * 60 * 60 * 1000);
    }, 60 * 60 * 1000);
    logger.info('Backup manager started');
  } catch {
    logger.warn('Backup manager unavailable');
  }

  // ── Self-Evolution Helpers ──

  /** Run Curator consolidation on a session transcript. */
  // ── Curator AgentLoop factory (shared across curator tasks) ──

  function createCuratorLoop(): AgentLoop | null {
    if (!gateway) return null;

    const role = agentRegistry.get('curator');
    if (!role) return null;

    const executor = new ToolExecutor();

    // Build tool dependencies focused on Curator's needs (memory, decisions, events, project)
    const curatorDeps: ToolDependencies = {
      decisionStore: decisionRepo,
      eventBus: eventBus!,
      shortTerm,
      longTerm,
      entity,
      project,
      createDecision(input) {
        const id = `dec_${Date.now()}`;
        return decisionService.create({
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
      approveDecision: (decisionId, captainId, chosenOptionId) =>
        decisionService.approve(decisionId, captainId, chosenOptionId),
      rejectDecision: (decisionId, captainId) =>
        decisionService.reject(decisionId, captainId),
      listWorkflows: () => [],
      getWorkflow: () => undefined,
      createWorkflow: () => ({ id: '' }),
      updateWorkflow: () => {},
      deleteWorkflow: () => {},
      runWorkflow: async () => ({ runId: '', status: 'not_implemented' }),
      startMeeting: async (topic) => ({ meetingId: '', topic, synthesis: '', perspectives: [] }),
      writeLongTermMemory: async (content, metadata) =>
        longTerm.store({ content, metadata: metadata ?? {}, timestamp: new Date() }),
      createEmployee: () => {},
      registerAgent: (input) => {
        agentRegistry.register({
          type: 'custom' as const,
          name: input.name,
          description: input.description,
          systemPrompt: input.systemPrompt,
          modelTier: (input as any).modelTier ?? 'default',
          model: input.model,
          temperature: input.temperature,
          maxResponseTokens: input.maxResponseTokens,
          allowedTools: input.allowedTools,
          contextBudget: input.contextBudget,
        });
        return { type: 'custom', name: input.name };
      },
      updateAgent: () => {},
      deleteAgent: () => {},
      invokeAgent: async () => { throw new Error('Agent invocation not available for Curator background task'); },
      listAgents: () => agentRegistry.list().map((r) => ({
        type: r.type, name: r.name, description: r.description, builtIn: r.type !== 'custom',
      })),
      setProjectContext: (pid) => ({ id: pid, name: pid }),
      createProject: (input) => ({ id: `proj_${Date.now()}`, name: input.name }),
      listProjects: () => [],
      getProjectContext: (pid) => {
        const p = project.get(pid);
        return p ? { id: pid, name: p.summary } : null;
      },
      // File / web / shell / scheduler / knowledge / eval — stubs for curator
      readFile: async () => { throw new Error('File access not available for Curator background task'); },
      writeFile: async () => { throw new Error('File write not available'); },
      editFile: async () => { throw new Error('File edit not available'); },
      applyPatch: async () => { throw new Error('Patch not available'); },
      moveFile: async () => { throw new Error('File move not available'); },
      copyFile: async () => { throw new Error('File copy not available'); },
      makeDirectory: async () => { throw new Error('Directory creation not available'); },
      fileInfo: async () => { throw new Error('File info not available'); },
      listDirectory: async () => { throw new Error('Directory listing not available'); },
      searchFiles: async () => { throw new Error('File search not available'); },
      searchContent: async () => { throw new Error('Content search not available'); },
      deleteFile: async () => { throw new Error('File deletion not available'); },
      recentFiles: async () => [],
      watchFile: async () => ({ changed: false, size: 0 }),
      indexProject: async () => ({ indexed: 0, skipped: 0, errors: 1 }),
      webFetch: async () => { throw new Error('Web access not available'); },
      httpRequest: async () => { throw new Error('HTTP not available'); },
      execCommand: async () => { throw new Error('Shell not available'); },
      scheduleTask: async () => { throw new Error('Scheduler not available'); },
      listScheduledTasks: async () => [],
      cancelScheduledTask: async () => { throw new Error('Scheduler not available'); },
      indexDocument: async () => { throw new Error('Indexing not available'); },
      searchDocuments: async () => { throw new Error('Document search not available'); },
      clearDocumentIndex: async () => { throw new Error('Index management not available'); },
      evaluateOutput: async () => { throw new Error('Evaluation not available'); },
      workspaceSymbols: async () => ({ available: false, error: 'LSP not available for Curator background task' }),
      goToDefinition: async () => ({ available: false, error: 'LSP not available for Curator background task' }),
      findReferences: async () => ({ available: false, error: 'LSP not available for Curator background task' }),
      diagnostics: async () => ({ available: false, error: 'LSP not available for Curator background task' }),
    };

    registerCabinetTools(executor, curatorDeps);
    registerSkillTools(executor);

    // Restrict to Curator's allowed tools
    if (role.allowedTools.length > 0) {
      for (const toolName of executor.listTools()) {
        if (!role.allowedTools.includes(toolName)) {
          executor.unregister(toolName);
        }
      }
    }

    const checkpointManager = new CheckpointManager(db);
    return new AgentLoop({
      gateway,
      toolExecutor: executor,
      safetyChecker: new SafetyChecker(currentTier),
      checkpointManager,
      memoryProvider: {
        getShortTerm: async (sid) => {
          const items: { role: 'user' | 'assistant'; content: string }[] = [];
          const session = sessionManager.get(sid);
          if (session && session.messages.length > 0) {
            const recent = session.messages.slice(-20);
            for (const m of recent) {
              items.push({ role: m.role, content: m.content });
            }
          }
          const kv = shortTerm.getAll(sid);
          for (const [k, v] of Object.entries(kv)) {
            if (typeof v === 'string' && v.length > 0) {
              items.push({ role: 'user' as const, content: `[${k}]: ${v}` });
            }
          }
          return items;
        },
        getProjectContext: async (pid) => {
          const p = project.get(pid);
          if (!p) return `Project: ${pid}`;
          return `Project: ${p.summary}\nGoals: ${p.goals.join(', ')}`;
        },
        getEntityPreferences: async (cid) => {
          const prefs = entity.getPreferences(cid);
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
          const results = await longTerm.search(query, RAG_CURATOR_TOP_K, embedding);
          return results.map((r) => `[Memory] ${r.content}`);
        },
      },
      sessionId: `curator_bg_${Date.now()}`,
      projectId: 'default',
      captainId: DEFAULT_CAPTAIN_ID,
      systemPrompt: role.systemPrompt,
      model: ((gateway as any)?.resolveModelString?.(role.modelTier) as string) ?? role.model,
      maxSteps: role.maxSteps ?? 50,
      maxResponseTokens: role.maxResponseTokens,
      temperature: role.temperature,
      contextBudget: role.contextBudget,
    });
  }

  // ── Curator concurrency control ──
  let curatorBusy = false;
  const curatorQueue: Array<{ task: () => Promise<void>; label: string }> = [];

  async function enqueueCuratorTask(task: () => Promise<void>, label: string): Promise<void> {
    if (curatorBusy) {
      // Replace existing queued task of the same label (debounce)
      const existingIdx = curatorQueue.findIndex((t) => t.label === label);
      if (existingIdx !== -1) {
        curatorQueue[existingIdx] = { task, label };
      } else {
        curatorQueue.push({ task, label });
      }
      return;
    }
    curatorBusy = true;
    try {
      await task();
    } finally {
      curatorBusy = false;
      // Process next queued task
      const next = curatorQueue.shift();
      if (next) {
        enqueueCuratorTask(next.task, next.label).catch((e) =>
          logger.warn('Curator queued task failed', { label: next.label, error: (e as Error).message }),
        );
      }
    }
  }

  // Wire the deferred curator decision update trigger
  _triggerCuratorDecisionUpdate = (decisionId, action, title, chosenOptionId) => {
    enqueueCuratorTask(async () => {
      const loop = createCuratorLoop();
      if (!loop) return;

      const taskPrompt = [
        `## Decision Preference Update`,
        '',
        `A decision was just ${action}: "${title}" (id: ${decisionId}, chosen: ${chosenOptionId ?? 'none'}).`,
        '',
        `Instructions:`,
        `1. Use get_decision to read the full decision record.`,
        `2. Use get_captain_preferences to see the current preference profile.`,
        `3. Analyze what this decision reveals about the Captain's preferences (risk tolerance, cost sensitivity, decision style).`,
        `4. If you detect a shift or refinement, use set_captain_preferences to update the profile.`,
        `5. Use write_memory to store any notable pattern you discover.`,
        '',
        `Be concise — this is a background task triggered by each decision resolution.`,
      ].join('\n');

      const result = await loop.run(taskPrompt);
      logger.info('Curator decision preference update completed', {
        decisionId,
        action,
        preview: result.content.slice(0, 150),
      });
    }, 'preference').catch((e: any) => {
      logger.warn('Curator decision preference update failed', { decisionId, error: e.message });
    });
  };

  async function runCuratorConsolidation(
    sessionId: string,
    transcript: string,
  ): Promise<void> {
    const loop = createCuratorLoop();
    if (!loop) {
      logger.warn('Curator consolidation skipped — no gateway or role');
      return;
    }

    // Layered transcript summarization for long sessions
    let processedTranscript = transcript;
    if (transcript.length > 8000) {
      // Split into 4000-char chunks with 200-char overlap
      const chunks: string[] = [];
      let offset = 0;
      const chunkSize = 4000;
      const overlap = 200;
      while (offset < transcript.length) {
        chunks.push(transcript.slice(offset, offset + chunkSize));
        if (offset + chunkSize >= transcript.length) break;
        offset += chunkSize - overlap;
      }

      // Generate one-sentence summary per chunk using the gateway directly
      if (gateway && chunks.length > 1) {
        const chunkSummaries: string[] = [];
        for (let i = 0; i < chunks.length; i++) {
          try {
            const resp = await gateway.generateText({
              model: 'claude-haiku-4-5',
              messages: [{ role: 'user', content: `Summarize this conversation segment in one sentence (in the original language):\n\n${chunks[i]}` }],
              maxTokens: 150,
              temperature: 0.1,
            });
            chunkSummaries.push(`[Segment ${i + 1}]: ${resp.content.trim()}`);
          } catch {
            chunkSummaries.push(`[Segment ${i + 1}]: (summary unavailable)`);
          }
        }
        processedTranscript = chunkSummaries.join('\n');
      }
    }

    const taskPrompt = [
      `## Background Consolidation Task`,
      '',
      `You are running as a background curator. Consolidate knowledge from this session transcript.`,
      '',
      `Instructions:`,
      `1. Read the transcript and identify important facts, decisions, and insights.`,
      `2. Use search_memory to check if similar information already exists in long-term memory.`,
      `3. Use write_memory to persist NEW or UPDATED information (importance ≥ 0.5). Skip duplicates.`,
      `4. Use query_decisions to check if any discussed decisions already have formal records.`,
      `5. Use update_project_summary if the project direction has meaningfully changed.`,
      `6. Use remember to store a brief session summary in short-term memory for the next interaction.`,
      '',
      `Session transcript:`,
      processedTranscript.slice(0, 8000),
      '',
      `After completing all steps, output a one-line summary of what you consolidated.`,
    ].join('\n');

    try {
      const result = await loop.run(taskPrompt);
      logger.info('Curator consolidation completed', {
        sessionId,
        steps: result.steps,
        toolCalls: result.toolCalls,
        preview: result.content.slice(0, 200),
      });
    } catch (e: any) {
      logger.warn('Curator consolidation failed', { sessionId, error: e.message });
    }
  }

  /** Prepare a context brief for a newly created session. */
  async function runCuratorBrief(sessionId: string): Promise<void> {
    const loop = createCuratorLoop();
    if (!loop) return;

    const taskPrompt = [
      `## Session Brief Task`,
      '',
      `A new session has just been created. Prepare a context brief that will be shown to the Captain at session start.`,
      '',
      `Instructions:`,
      `1. Use get_recent_events to see what happened recently.`,
      `2. Use query_decisions to find pending decisions that need attention.`,
      `3. Use search_memory to find relevant recent context.`,
      `4. Use get_project_context to understand the current project state.`,
      `5. Synthesize a brief (2-3 concise sentences) covering: recent activity, pending decisions, and what needs attention.`,
      '',
      `After your analysis, output ONLY the brief text — no JSON, no tools, just the plain text brief.`,
    ].join('\n');

    try {
      const result = await loop.run(taskPrompt);
      const brief = result.content.trim();
      if (brief.length > 0) {
        // Store directly in the user's session short-term memory
        shortTerm.set(sessionId, 'session_brief', brief);
        logger.info('Curator session brief prepared', { sessionId, preview: brief.slice(0, 200) });
      }
    } catch (e: any) {
      logger.warn('Curator session brief failed', { sessionId, error: e.message });
    }
  }

  /** Cross-session pattern extraction — review decisions and memories to find patterns. */
  async function runCuratorPatternExtraction(): Promise<void> {
    const loop = createCuratorLoop();
    if (!loop) return;

    const taskPrompt = [
      `## Pattern Extraction Task`,
      '',
      `You are the Curator. Review recent history to extract patterns.`,
      '',
      `Instructions:`,
      `1. Use query_decisions to list all decisions from the last 7 days.`,
      `2. Use get_decision to review key decisions — look for patterns in what was chosen.`,
      `3. Use search_memory to find related context around each decision.`,
      `4. Use get_captain_preferences to see current preference profile.`,
      `5. Identify patterns: recurring decision types, risk tolerance signals, cost sensitivity, preferred decision styles.`,
      `6. Use write_memory to store each pattern you find (importance ≥ 0.7).`,
      `7. If patterns differ from current preferences, use set_captain_preferences to update the preference profile.`,
      `8. Use update_project_summary if the overall project picture has changed.`,
      '',
      `Focus on actionable patterns — not vague observations. Each pattern should cite specific decisions as evidence.`,
    ].join('\n');

    try {
      const result = await loop.run(taskPrompt);
      logger.info('Curator pattern extraction completed', {
        steps: result.steps,
        toolCalls: result.toolCalls,
        preview: result.content.slice(0, 200),
      });
    } catch (e: any) {
      logger.warn('Curator pattern extraction failed', { error: e.message });
    }
  }

  // ── Self-Evolution Infrastructure ──

  // Memory consolidation: lightweight backup runs every 30 minutes (no LLM needed)
  const consolidation = new ConsolidationService(shortTerm, longTerm);
  const consolidationTimer = setInterval(
    async () => {
      try {
        for (const sid of shortTerm.getAllSessionIds()) {
          await consolidation.consolidateBasic(sid);
        }
      } catch (e: any) {
        logger.warn('Basic consolidation failed', { error: e.message });
        broadcast('background_error', { task: 'consolidation', error: e.message });
      }
    },
    30 * 60 * 1000,
  );
  consolidationTimer.unref();
  logger.info('Basic memory consolidation scheduled (30min)');

  // Observability session persistence (every 30 minutes)
  const observabilityTimer = setInterval(
    () => {
      try {
        const now = new Date();
        const summary = metrics.getSummary();
        metricRepo.insert('observability_snapshot', JSON.stringify(summary), { date: now.toISOString().slice(0, 10), type: 'daily' });

        // Persist recent session metrics to DB
        const { sessions } = observability.export();
        for (const s of sessions) {
          const totalTokens = (s.totalTokens?.prompt ?? 0) + (s.totalTokens?.completion ?? 0);
          const durationMs = s.startTime && s.endTime
            ? new Date(s.endTime).getTime() - new Date(s.startTime).getTime()
            : 0;
          const success = s.errors
            ? (s.errors.fatal === 0 ? 1 : 0)
            : 1;
          const errorType = s.errors && s.errors.fatal > 0 ? 'fatal'
            : s.errors && s.errors.recoverable > 0 ? 'recoverable'
            : null;
          sessionMetricsRepo.upsert({
            session_id: s.sessionId,
            project_id: s.projectId ?? null,
            role: s.role ?? null,
            model: s.model ?? null,
            total_steps: s.totalSteps,
            total_tokens: totalTokens,
            total_cost: s.totalCost,
            tool_calls_total: s.toolCalls?.total ?? 0,
            tool_calls_failed: s.toolCalls?.failed ?? 0,
            tool_calls_blocked: s.toolCalls?.blocked ?? 0,
            duration_ms: durationMs,
            success,
            error_type: errorType,
            started_at: s.startTime,
            ended_at: s.endTime ?? now.toISOString(),
          });
        }
        // Cleanup sessions older than 30 days
        sessionMetricsRepo.pruneOlderThan(30);
      } catch (e: any) {
        logger.warn('Observability persistence failed', { error: e.message });
        broadcast('background_error', { task: 'observability', error: e.message });
      }
    },
    30 * 60 * 1000,
  );
  observabilityTimer.unref();
  logger.info('Observability persistence scheduled (30 min)');

  // Curator self-nudge timer: runs every 4 hours when gateway is available
  const curatorNudgeTimer = setInterval(
    async () => {
      if (!gateway) return;
      try {
        const sessions = sessionManager.list();
        for (const s of sessions) {
          if (s.messages.length > 0) {
            const messages = s.messages.map((m) => `${m.role}: ${m.content}`).join('\n');
            if (messages.length > 200) {
              await enqueueCuratorTask(
                () => runCuratorConsolidation(s.id, messages),
                'nudge',
              );
            }
          }
        }
      } catch (e: any) {
        logger.warn('Curator nudge failed', { error: e.message });
        broadcast('background_error', { task: 'curator_nudge', error: e.message });
      }
    },
    4 * 60 * 60 * 1000,
  );
  curatorNudgeTimer.unref();
  logger.info('Curator self-nudge scheduled (4h)');

  // Curator cross-session pattern extraction: runs every 6 hours
  const curatorPatternTimer = setInterval(
    async () => {
      if (!gateway) return;
      try {
        await enqueueCuratorTask(
          () => runCuratorPatternExtraction(),
          'pattern',
        );
      } catch (e: any) {
        logger.warn('Curator pattern extraction failed', { error: e.message });
        broadcast('background_error', { task: 'curator_pattern', error: e.message });
      }
    },
    6 * 60 * 60 * 1000,
  );
  curatorPatternTimer.unref();
  logger.info('Curator pattern extraction scheduled (6h)');

  // Wire session compression callback to Curator background task
  // (registered here because it depends on enqueueCuratorTask and gateway)
  sessionManager.onCompressionNeeded((session) => {
    const gw = gateway;
    if (!gw) return;
    const middleStart = SESSION_KEEP_OLDEST;
    const middleEnd = session.messages.length - SESSION_KEEP_RECENT;
    const middleMessages = session.messages.slice(middleStart, middleEnd);
    const middleText = middleMessages.map((m) => `${m.role}: ${m.content.slice(0, 200)}`).join('\n');

    if (middleText.length > 200) {
      enqueueCuratorTask(
        async () => {
          try {
            const resp = await gw.generateText({
              model: 'claude-haiku-4-5',
              messages: [{ role: 'user', content: `Summarize this conversation segment in 2-3 sentences (in the original language), capturing key decisions, topics discussed, and outcomes:\n\n${middleText.slice(0, 4000)}` }],
              maxTokens: 200,
              temperature: 0.1,
            });
            sessionManager.compactMessages(session.id, resp.content.trim());
            logger.info('Session compression completed', { sessionId: session.id, msgCount: session.messages.length });
          } catch (e: any) {
            // Fallback: simple truncation
            sessionManager.compactMessages(session.id, `${middleMessages.length} intermediate messages compressed.`);
            logger.warn('Session compression fell back to truncation', { sessionId: session.id, error: e.message });
          }
        },
        'compress',
      ).catch((e) => logger.warn('Session compression failed', { sessionId: session.id, error: (e as Error).message }));
    }
  });

  // Shared agent registry (custom roles persist across requests)
  const agentRegistry = new AgentRoleRegistry();
  // Load custom agents from DB
  try {
    const customRows = agentRoleRepo.findCustom();
    for (const row of customRows) {
      agentRegistry.register({
        type: 'custom' as const,
        name: row.name,
        description: row.description,
        systemPrompt: row.system_prompt,
        modelTier: ((row.model_tier as string) || 'default') as ModelTier,
        model: row.model,
        temperature: row.temperature,
        maxResponseTokens: row.max_response_tokens,
        allowedTools: JSON.parse(row.allowed_tools ?? '[]'),
        contextBudget: row.context_budget,
      });
    }
    logger.info('Custom agents loaded from DB', { count: customRows.length });
  } catch (e) {
    logger.warn('Failed to load custom agents from DB', { error: String(e) });
  }

  // Shared skill registry — load from DB on startup
  const skillRegistry = new SkillRegistry();
  try {
    const skillRows = skillRepo.findActive();
    for (const row of skillRows) {
      skillRegistry.register({
        id: row.id,
        name: row.name,
        description: row.description,
        kind: row.kind as 'tool' | 'prompt' | 'composite',
        promptTemplate: row.prompt_template,
        inputSchema: JSON.parse(row.input_schema ?? '{}'),
        outputSchema: JSON.parse(row.output_schema ?? '{}'),
        version: row.version,
        status: row.status as 'active' | 'draft' | 'deprecated',
      });
    }
    logger.info('Skill registry loaded', { count: skillRows.length });
  } catch (e) {
    logger.warn('Failed to load skills from DB', { error: String(e) });
  }

  // MCP Manager — connect to configured MCP servers (non-blocking)
  const mcpManager = new MCPManager(logger);
  try {
    // Load MCP configs from DB (legacy) and from ~/.cabinet/mcp/*.json
    const mcpConfigs: import('./mcp/mcp-manager.js').MCPServerConfig[] = [];
    const mcpDir = join(dataDir, 'mcp');
    try {
      const mcpFiles = readdirSync(mcpDir).filter((f) => f.endsWith('.json'));
      for (const f of mcpFiles) {
        try {
          const cfg = JSON.parse(readFileSync(join(mcpDir, f), 'utf-8'));
          mcpConfigs.push({
            name: cfg.name ?? f.replace('.json', ''),
            transport: 'stdio',
            command: cfg.command ?? 'npx',
            args: cfg.args ?? [],
            enabled: cfg.enabled ?? true,
          });
        } catch { /* skip malformed */ }
      }
    } catch { /* mcp dir empty */ }
    // Also load from DB settings (merge, file-based take priority)
    try {
      const value = settingsRepo.get('mcp_servers');
      const dbConfigs: import('./mcp/mcp-manager.js').MCPServerConfig[] = JSON.parse(value ?? '[]');
      for (const dbCfg of dbConfigs) {
        if (!mcpConfigs.some((fc) => fc.name === dbCfg.name)) {
          mcpConfigs.push(dbCfg);
        }
      }
    } catch { /* db settings not available */ }
    if (mcpConfigs.length > 0) {
      void mcpManager.initialize(mcpConfigs).catch(() => {
        logger.info('MCP initialization failed — check server configs');
      });
    }
  } catch {
    logger.info('MCP settings table not available — skipping MCP initialization');
  }

  // ── Directory Scanning: Skills ──
  // Scan ~/.cabinet/skills/ and register any skills not already in DB
  {
    const skillsDir = join(dataDir, 'skills');
    try {
      const skillDirs = readdirSync(skillsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory());
      for (const entry of skillDirs) {
        const skillPath = join(skillsDir, entry.name, 'SKILL.md');
        if (!existsSync(skillPath)) continue;
        try {
          const content = readFileSync(skillPath, 'utf-8');
          const result = importSkillFromMarkdown(content, skillRegistry);
          if (result) {
            // Sync to DB if not present
            const existing = skillRepo.findByName(result.name);
            if (!existing) {
              const skill = skillRegistry.load(result.name);
              if (skill) {
                skillRepo.insert({
                  id: skill.id,
                  name: skill.name,
                  description: skill.description,
                  kind: skill.kind,
                  input_schema: '{}',
                  output_schema: '{}',
                  prompt_template: skill.promptTemplate,
                  version: 1,
                  status: 'active',
                  metadata: null,
                  references_path: null,
                  scripts_path: null,
                });
              }
            }
          }
        } catch { /* skip malformed skill */ }
      }
      logger.info('Skills scanned from directory', { dir: skillsDir });
    } catch { /* skills dir empty */ }
  }

  // ── Directory Scanning: Agents ──
  // Scan ~/.cabinet/agents/ and register any agents not already in DB
  {
    const agentsDir = join(dataDir, 'agents');
    try {
      const agentDirs = readdirSync(agentsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory());
      for (const entry of agentDirs) {
        const agentJsonPath = join(agentsDir, entry.name, 'agent.json');
        if (!existsSync(agentJsonPath)) continue;
        try {
          const agentCard = JSON.parse(readFileSync(agentJsonPath, 'utf-8'));
          const name = agentCard.name ?? entry.name;
          const existing = agentRoleRepo.findByName(name);
          if (!existing) {
            agentRegistry.register({
              type: 'custom' as const,
              name,
              description: agentCard.description ?? '',
              systemPrompt: agentCard.systemPrompt ?? agentCard.instructions ?? '',
              modelTier: (agentCard.modelTier as ModelTier) ?? 'default',
              model: agentCard.model ?? agentCard.defaultModel ?? 'claude-sonnet-4-6',
              temperature: agentCard.temperature ?? 0.7,
              maxResponseTokens: agentCard.maxResponseTokens ?? agentCard.maxTokens ?? 4096,
              allowedTools: agentCard.allowedTools ?? [],
              contextBudget: agentCard.contextBudget ?? agentCard.contextWindow ?? 0.3,
            });
            agentRoleRepo.upsert({
              type: 'custom',
              name,
              description: agentCard.description ?? '',
              system_prompt: agentCard.systemPrompt ?? agentCard.instructions ?? '',
              model: agentCard.model ?? agentCard.defaultModel ?? 'claude-sonnet-4-6',
              model_tier: (agentCard.modelTier as string) ?? 'default',
              temperature: agentCard.temperature ?? 0.7,
              max_response_tokens: agentCard.maxResponseTokens ?? agentCard.maxTokens ?? 4096,
              allowed_tools: JSON.stringify(agentCard.allowedTools ?? []),
              context_budget: agentCard.contextBudget ?? agentCard.contextWindow ?? 0.3,
              is_builtin: 0,
              created_at: new Date().toISOString(),
            });
          }
        } catch { /* skip malformed agent */ }
      }
      logger.info('Agents scanned from directory', { dir: agentsDir });
    } catch { /* agents dir empty */ }
  }

  // ── Directory Scanning: Projects ──
  // Scan ~/.cabinet/projects/ and restore any projects not already in DB
  {
    const projectsDir = join(dataDir, 'projects');
    try {
      const projFiles = readdirSync(projectsDir).filter((f) => f.endsWith('.json'));
      for (const f of projFiles) {
        try {
          const proj = JSON.parse(readFileSync(join(projectsDir, f), 'utf-8'));
          const existing = projectRepo.findById(proj.id);
          if (!existing) {
            projectRepo.create({
              id: proj.id,
              name: proj.name,
              description: proj.description ?? '',
              status: 'active' as const,
              rootPath: proj.rootPath ?? '',
              createdAt: new Date(),
            });
            projectContextRepo.insert({
              project_id: proj.id,
              summary: '',
              goals: '[]',
              milestones: '[]',
              constraints: '{}',
              tech_summary: '',
              risk_map: '[]',
              key_decisions: '[]',
              updated_at: new Date().toISOString(),
            });
          }
        } catch { /* skip malformed project index */ }
      }
      logger.info('Projects scanned from directory', { dir: projectsDir });
    } catch { /* projects dir empty */ }
  }

  // ── Settings.json loading ──
  // Load settings from ~/.cabinet/settings.json into DB on startup
  {
    const settingsPath = join(dataDir, 'settings.json');
    try {
      if (existsSync(settingsPath)) {
        const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
        if (settings.mcpServers) {
          settingsRepo.set('mcp_servers', JSON.stringify(settings.mcpServers));
        }
        if (settings.delegationTier) {
          setCurrentTier(settings.delegationTier as DelegationTier);
        }
        if (settings.modelMapping) {
          modelMapping = settings.modelMapping as ModelMapping;
        }
        if (settings.providers) {
          providerConfigsFromSettings = settings.providers as Record<string, ProviderEntry>;
        }
        logger.info('Settings loaded from file', { path: settingsPath });
      }
    } catch { /* settings file not present or corrupt */ }
  }

  // ── CABINET.md template ──
  // Create default CABINET.md in ~/.cabinet/ if it doesn't exist
  {
    const cabinetMdPath = join(dataDir, 'CABINET.md');
    if (!existsSync(cabinetMdPath)) {
      const template = [
        '# Cabinet Configuration',
        '',
        'Edit this file to customize your Cabinet AI team.',
        '',
        '## Captain',
        '',
        '- **Name:** Captain',
        '- **Role:** Decision maker',
        '',
        '## Preferences',
        '',
        'Add your preferences here to guide the AI cabinet:',
        '- Communication style: concise / detailed',
        '- Risk tolerance: low / medium / high',
        '- Preferred decision style: consensus / directive / analytical',
        '',
        '## Custom Rules',
        '',
        'Add custom rules that apply to all AI interactions:',
        '',
      ].join('\n');
      try {
        writeFileSync(cabinetMdPath, template, 'utf-8');
        logger.info('CABINET.md template created', { path: cabinetMdPath });
      } catch { /* readonly filesystem */ }
    }
  }

  // ── Feedback Loop ──

  const observability = new ObservabilityCollector(eventBus);

  // Preference learner: analyze Captain decision patterns via LLM
  const preferenceAnalysisCallback: PreferenceAnalysisCallback = async (
    captainId,
    decisionHistory,
    existingPreferences,
  ) => {
    if (!gateway) return PreferenceLearner.defaultProfile();
    try {
      const response = await gateway.generateText({
        model: 'claude-haiku-4-5',
        messages: [
          {
            role: 'user',
            content: [
              "Analyze this decision history and extract the Captain's preferences.",
              `Captain: ${captainId}`,
              `Decisions: ${JSON.stringify(decisionHistory.slice(-20))}`,
              `Existing preferences: ${JSON.stringify(existingPreferences)}`,
              'Respond with ONLY a JSON object:',
              '{',
              '  "riskTolerance": "low"|"medium"|"high",',
              '  "costSensitivity": "low"|"medium"|"high",',
              '  "timeUrgency": "relaxed"|"moderate"|"urgent",',
              '  "preferredDecisionStyle": "consensus"|"directive"|"analytical",',
              '  "commonRejectionReasons": ["reason1"],',
              '  "domainPreferences": {"domain": "preference"},',
              '  "confidence": 0.8',
              '}',
            ].join('\n'),
          },
        ],
        maxTokens: 300,
        temperature: 0.2,
      });
      const match = response.content.match(/\{[\s\S]*\}/);
      if (!match) return PreferenceLearner.defaultProfile();
      return { ...PreferenceLearner.defaultProfile(), ...JSON.parse(match[0]) };
    } catch {
      return PreferenceLearner.defaultProfile();
    }
  };

  const preferenceLearner = new PreferenceLearner(entity, preferenceAnalysisCallback);

  // Auto-adjuster: read health metrics, adjust model/router/config
  const adjustmentNotifyCallback: AdjustmentNotifyCallback = async (action) => {
    logger.info(
      'Adjustment requiring Captain approval',
      action as unknown as Record<string, unknown>,
    );
    await eventBus.publish({
      messageId: `adj_notify_${Date.now()}`,
      correlationId: `adj_${Date.now()}`,
      causationId: null,
      timestamp: new Date(),
      messageType: MessageType.SystemNotification,
      payload: { type: 'adjustment_pending', data: action as unknown as Record<string, unknown> },
    });
    return true;
  };

  const autoAdjuster = new AutoAdjuster(
    observability,
    agentRegistry,
    eventBus,
    (tier: string, model: string) => {
      modelMapping = { ...modelMapping, [tier]: model };
      if (gateway && (gateway as any).setModelMapping) {
        (gateway as any).setModelMapping(modelMapping);
      }
    },
    adjustmentNotifyCallback,
  );

  // Skill extraction
  const skillExtractor = new SkillExtractor(gateway);

  // Knowledge graph
  const knowledgeGraph = new KnowledgeGraph(db);
  knowledgeGraph.ensureTables();

  // Memory decay
  const memoryDecay = new MemoryDecayService(longTerm);

  // Subconscious loop
  const subconsciousLoop = new SubconsciousLoop(longTerm, knowledgeGraph, eventBus);

  // Wire knowledge graph into long-term memory for contradiction detection
  longTerm.setKnowledgeGraph(knowledgeGraph);
  longTerm.setContradictionHandler((contradiction) => {
    // Medium-confidence contradictions (0.5-0.8) create a decision for Captain
    logger.info('Contradiction detected', {
      oldMemoryId: contradiction.oldMemoryId,
      confidence: contradiction.confidence,
      newMemoryId: contradiction.newMemoryId,
    });
    // Publish as system notification so Secretary can surface it
    eventBus.publish({
      messageId: `contradiction_${Date.now()}`,
      correlationId: contradiction.newMemoryId,
      causationId: null,
      timestamp: new Date(),
      messageType: MessageType.SystemNotification,
      payload: {
        type: 'memory_contradiction',
        oldMemoryId: contradiction.oldMemoryId,
        oldContent: contradiction.oldContent.slice(0, 200),
        confidence: contradiction.confidence,
        newMemoryId: contradiction.newMemoryId,
        message: `A new memory may contradict an existing one (${Math.round(contradiction.confidence * 100)}% confidence).`,
      } as any,
    }).catch(() => {});
  });

  // Subscribe to subconscious insights — surface high-relevance ones via broadcast
  eventBus.subscribe(MessageType.SystemNotification, (msg) => {
    const payload = (msg.payload as unknown) as Record<string, unknown> | undefined;
    if (payload?.type === 'subconscious_insight') {
      const insight = payload.insight as Record<string, unknown> | undefined;
      if ((insight?.relevance as number) ?? 0 > 0.7) {
        broadcast('subconscious_insight', {
          text: insight?.text,
          relevance: insight?.relevance,
          sourceMemoryId: insight?.sourceMemoryId,
        });
      }
    }
  });

  // Quality response: subscribe to quality alerts, trigger adjustments + re-consolidation
  const reconsolidationCallback: ReconsolidationCallback = async () => {
    if (!gateway) return;
    try {
      for (const sid of shortTerm.getAllSessionIds()) {
        await consolidation.consolidateBasic(sid);
      }
      logger.info('Re-consolidation triggered by quality alert');
    } catch (e: any) {
      logger.warn('Re-consolidation failed', { error: e.message });
    }
  };

  const qualityResponse = new QualityResponseService(
    eventBus,
    autoAdjuster,
    () => currentTier,
    reconsolidationCallback,
  );

  // Hourly auto-adjustment health check
  const autoAdjustTimer = setInterval(
    async () => {
      try {
        await autoAdjuster.runHealthCheck(currentTier);
      } catch (e: any) {
        logger.warn('Auto-adjustment health check failed', { error: e.message });
        broadcast('background_error', { task: 'auto_adjust', error: e.message });
      }

      // Budget enforcement check
      try {
        const budget = budgetGuard.canProceed(); // periodic check: non-L3 context — L3 decisions always bypass budget
        if (!budget.allowed && eventBus) {
          const todayCost = costTracker.getDailyCost();
          await eventBus.publish({
            messageId: `budget_alert_${Date.now()}`,
            correlationId: `budget_alert_${Date.now()}`,
            causationId: null,
            timestamp: new Date(),
            messageType: MessageType.BudgetAlert,
            payload: {
              level: 'critical' as const,
              currentSpend: todayCost,
              limit: DAILY_BUDGET_USD,
              period: 'daily' as const,
            },
          });
          broadcast('budget_alert', {
            reason: budget.reason ?? 'Budget limit exceeded',
            currentCost: todayCost,
          });
          logger.warn('BudgetAlert published', { todayCost, reason: budget.reason });
        }
      } catch (e: any) {
        logger.warn('Budget check failed', { error: e.message });
        broadcast('background_error', { task: 'budget_check', error: e.message });
      }
    },
    60 * 60 * 1000,
  );
  autoAdjustTimer.unref();
  logger.info('Auto-adjustment health check + budget enforcement scheduled (1h)');

  // Session expiry cleanup (every 6 hours)
  const sessionCleanupTimer = setInterval(
    () => {
      try {
        const cleaned = sessionManager.cleanExpiredSessions();
        if (cleaned > 0) {
          logger.info('Session cleanup completed', { cleaned });
        }
      } catch (e: any) {
        logger.warn('Session cleanup failed', { error: e.message });
      }
    },
    6 * 60 * 60 * 1000,
  );
  sessionCleanupTimer.unref();
  logger.info('Session cleanup scheduled (6h)');

  // Subconscious loop: runs every hour
  const subconsciousTimer = setInterval(
    async () => {
      try {
        await subconsciousLoop.tick();
        logger.info('Subconscious loop tick completed');
      } catch (e: any) {
        logger.warn('Subconscious loop tick failed', { error: e.message });
      }
    },
    60 * 60 * 1000,
  );
  subconsciousTimer.unref();
  logger.info('Subconscious loop scheduled (1h)');

  // Workflow approval polling (30s fallback for missed WebSocket events)
  startApprovalPolling(30_000);
  logger.info('Workflow approval polling started (30s)');

  const shutdown = () => {
    logger.info('Shutting down server context...');
    clearInterval(consolidationTimer);
    clearInterval(observabilityTimer);
    clearInterval(curatorNudgeTimer);
    clearInterval(curatorPatternTimer);
    clearInterval(autoAdjustTimer);
    clearInterval(sessionCleanupTimer);
    clearInterval(subconsciousTimer);
    clearInterval(memoryMaintenanceTimer);
    stopApprovalPolling();
    taskScheduler.stop();
    try {
      backupManager?.stopAutoBackup();
    } catch {
      /* backup manager may already be stopped */
    }
    try {
      db.close();
    } catch {
      /* db may already be closed */
    }
    logger.info('Server context shut down');
  };

  // Task scheduler
  const taskScheduler = new TaskScheduler(new ScheduledTaskRepository(db), decisionRepo, logger);
  taskScheduler.start();

  // Memory maintenance: decay cycle every hour, index rebuild weekly on Sunday 3 AM
  const memoryMaintenanceTimer = setInterval(async () => {
    try {
      const result = await memoryDecay.runDecayCycle();
      if (result.expired > 0 || result.archived > 0) {
        logger.info('Memory decay cycle completed', { expired: result.expired, archived: result.archived, superseded: result.superseded });
      }
    } catch (err) {
      logger.error('Memory decay cycle failed', { error: (err as Error).message });
    }
    // Weekly rebuild check (Sunday ~3:00 AM local)
    const now = new Date();
    if (now.getDay() === 0 && now.getHours() === 3 && now.getMinutes() < 5) {
      try {
        logger.info('Starting weekly long-term memory index rebuild');
        await longTerm.rebuildIndex();
        logger.info('Weekly long-term memory index rebuild completed');
      } catch (err) {
        logger.error('Weekly index rebuild failed', { error: (err as Error).message });
      }
    }
  }, 3600000); // every hour

  // Wire TaskExecutor so scheduled tasks actually execute
  taskScheduler.setExecutor(async (task) => {
    if (!gateway) {
      logger.warn('Scheduled task skipped — no LLM gateway available', { taskId: task.id, name: task.name });
      return;
    }
    try {
      logger.info('Executing scheduled task', { taskId: task.id, name: task.name });
      const taskModel = (gateway as any).resolveModelString?.('fast_execution') ?? 'claude-haiku-4-5';
      const result = await gateway.generateText({
        model: taskModel,
        systemPrompt: 'You are a proactive Cabinet assistant executing a scheduled task. Be concise and actionable.',
        messages: [{ role: 'user', content: task.prompt }],
      });
      logger.info('Scheduled task completed', { taskId: task.id, name: task.name, preview: result.content.slice(0, 200) });
      // Store result in short-term memory for retrieval
      shortTerm.set(`system`, `task_result:${task.id}`, { name: task.name, prompt: task.prompt, result: result.content, executedAt: new Date().toISOString() }, 86400000);
      // Notify frontend via WebSocket
      broadcast('task_completed', {
        taskId: task.id,
        name: task.name,
        result: result.content,
        executedAt: new Date().toISOString(),
      });
      try {
        broadcast('cost_updated', {
          daily: costTracker.getDailyCost(),
          model: taskModel,
          timestamp: new Date().toISOString(),
        });
      } catch { /* non-fatal */ }
    } catch (err) {
      logger.error('Scheduled task failed', { taskId: task.id, name: task.name, error: (err as Error).message });
    }
  });

  const fileTracker = new FileAccessTracker();

  ctx = {
    db,
    decisionRepo,
    projectRepo,
    eventRepo,
    workflowRepo,
    auditLogRepo,
    deliverableRepo,
    apiKeyRepo,
    agentRoleRepo,
    skillRepo,
    employeeRepo,
    projectContextRepo,
    metricRepo,
    costHistoryRepo,
    sessionMetricsRepo,
    settingsRepo,
    decisionService,
    shortTerm,
    longTerm,
    entity,
    project,
    gateway,
    refreshGateway,
    costTracker,
    budgetGuard,
    sessionManager,
    fileTracker,
    delegationTier: currentTier,
    agentRegistry,
    skillRegistry,
    mcpManager,
    taskScheduler,
    observability,
    autoAdjuster,
    skillExtractor,
    knowledgeGraph,
    memoryDecay,
    subconsciousLoop,
    eventBus,
    metrics,
    logger,
    backupManager,
    shutdown,
  };

  return ctx;
}
