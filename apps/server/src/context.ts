import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { decryptApiKey } from './crypto.js';
import {
  createConnection,
  runMigration001,
  DecisionRepository,
  OrganizationRepository,
  ProjectRepository,
  EventLogRepository,
  MetricsCollector,
  BackupManager,
  getLogger,
} from '@cabinet/storage';
import type { Database } from '@cabinet/storage';
import {
  DecisionService,
  DecisionStateMachine,
  LevelClassifier,
  AuditLogger,
  EscalationService,
} from '@cabinet/decision';
import { AISDKAdapter, CostTracker, BudgetGuard, ModelRouter } from '@cabinet/gateway';
import {
  ShortTermMemory,
  LongTermMemory,
  EntityMemory,
  ProjectMemory,
  ConsolidationService,
} from '@cabinet/memory';
import { MemoryEventBus } from '@cabinet/events';
import { SessionManager } from '@cabinet/secretary';
import { config } from './config.js';
import type { LLMGateway } from '@cabinet/gateway';
import { DelegationTier, DEFAULT_DELEGATION_TIER, MessageType } from '@cabinet/types';
import { AgentRoleRegistry, CURATOR_ROLE } from '@cabinet/agent';
import {
  ObservabilityCollector,
  PreferenceLearner,
  AutoAdjuster,
  QualityResponseService,
} from '@cabinet/harness';
import type {
  PreferenceAnalysisCallback,
  AdjustmentNotifyCallback,
  ReconsolidationCallback,
} from '@cabinet/harness';

export interface ServerContext {
  db: Database;
  // Repos
  decisionRepo: DecisionRepository;
  orgRepo: OrganizationRepository;
  projectRepo: ProjectRepository;
  eventRepo: EventLogRepository;
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
  // Permissions
  delegationTier: DelegationTier;
  // Agent registry (shared across all requests — custom roles persist here)
  agentRegistry: AgentRoleRegistry;
  // Feedback loop
  observability: ObservabilityCollector;
  modelRouter: ModelRouter;
  autoAdjuster: AutoAdjuster;
  // Infrastructure
  eventBus: MemoryEventBus;
  metrics: MetricsCollector;
  logger: ReturnType<typeof getLogger>;
  backupManager: BackupManager | null;
  /** Clean up all timers, close DB, stop backup. Call on process exit. */
  shutdown: () => void;
}

let ctx: ServerContext | null = null;
let currentTier: DelegationTier = DEFAULT_DELEGATION_TIER;

export function getCurrentTier(): DelegationTier {
  return currentTier;
}

export function setCurrentTier(tier: DelegationTier): void {
  currentTier = tier;
  if (ctx) {
    ctx.delegationTier = tier;
  }
}

export function getServerContext(): ServerContext {
  if (ctx) return ctx;

  const logger = getLogger('server');

  // Database — use user's AppData directory so it works without admin rights
  const dataDir = process.env.APPDATA
    ? join(process.env.APPDATA, 'Cabinet')
    : join(process.cwd(), '.cabinet');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = join(dataDir, 'cabinet.db');

  let db: Database;
  try {
    db = createConnection(dbPath);
    runMigration001(db);
    logger.info('SQLite database initialized', { path: dbPath });
  } catch (e) {
    logger.error('Failed to initialize SQLite', { error: String(e) });
    try {
      db = createConnection(':memory:');
      runMigration001(db);
      logger.warn('Falling back to in-memory database');
    } catch (e2) {
      logger.error('SQLite completely unavailable — running without persistence', {
        error: String(e2),
      });
      db = createConnection(':memory:');
    }
  }

  // Seed: ensure default org and project exist (foreign key prerequisite)
  db.prepare(
    "INSERT OR IGNORE INTO organizations (id, name, captain_id) VALUES ('org-1', 'Default Organization', 'captain-1')",
  ).run();
  db.prepare(
    "INSERT OR IGNORE INTO projects (id, organization_id, name) VALUES ('proj-1', 'org-1', 'Default Project')",
  ).run();

  // Repositories
  const decisionRepo = new DecisionRepository(db);
  const orgRepo = new OrganizationRepository(db);
  const projectRepo = new ProjectRepository(db);
  const eventRepo = new EventLogRepository(db);

  // Decision service with preference learning
  const stateMachine = new DecisionStateMachine();
  const classifier = new LevelClassifier();
  const auditLog = new AuditLogger(db);
  const eventBus = new MemoryEventBus();
  const escalation = new EscalationService(eventBus);

  // Decision resolved callback: preference learning + workflow resumption
  const decisionService = new DecisionService(
    stateMachine,
    classifier,
    auditLog,
    escalation,
    decisionRepo,
    (decisionId, action, title, chosenOptionId, captainId) => {
      try {
        const cid = captainId ?? 'captain-1';

        // ── Workflow resumption ──
        const wfRow = db
          .prepare(
            "SELECT * FROM audit_log WHERE entity_type = 'workflow_approval' AND entity_id = ? ORDER BY timestamp DESC LIMIT 1",
          )
          .get(decisionId) as any;

        if (wfRow) {
          try {
            const wfData = JSON.parse(wfRow.changes ?? '{}');
            const wfId = wfData.workflowId as string;
            if (wfId) {
              if (action === 'approved' && chosenOptionId === 'approve_continue') {
                db.prepare("UPDATE workflows SET status = 'completed' WHERE id = ?").run(wfId);
                db.prepare(
                  "UPDATE audit_log SET action = 'approved', changes = ? WHERE entity_type = 'workflow_approval' AND entity_id = ?",
                ).run(JSON.stringify({ ...wfData, status: 'approved', decisionId }), decisionId);
                logger.info('Workflow approved via decision', { workflowId: wfId, decisionId });
              } else {
                db.prepare("UPDATE workflows SET status = 'failed' WHERE id = ?").run(wfId);
                db.prepare(
                  "UPDATE audit_log SET action = 'terminated', changes = ? WHERE entity_type = 'workflow_approval' AND entity_id = ?",
                ).run(JSON.stringify({ ...wfData, status: 'terminated', decisionId }), decisionId);
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

        entity.setPreferences(cid, existing?.name ?? cid, {
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
      } catch (e: any) {
        logger.warn('Preference learning failed', { error: e.message });
      }
    },
  );

  // Memory (shared DB for long-term)
  const shortTerm = new ShortTermMemory(db, 1000);
  const longTerm = new LongTermMemory(db);
  const entity = new EntityMemory(db);
  const project = new ProjectMemory(db);

  // Gateway + Cost
  const costTracker = new CostTracker();
  const budgetGuard = new BudgetGuard(costTracker);

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
      const rows = db.prepare('SELECT * FROM api_keys').all() as any[];
      for (const row of rows) {
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

    if (Object.keys(providerConfigs).length > 0) {
      return new AISDKAdapter(providerConfigs as any);
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

  // Metrics
  const metrics = new MetricsCollector();

  // Backup (if file DB)
  let backupManager: BackupManager | null = null;
  try {
    backupManager = new BackupManager({
      dbPath: 'cabinet.db',
      backupDir: './backups',
      intervalMinutes: 60,
      keepCount: 7,
    });
    backupManager.startAutoBackup();
    logger.info('Backup manager started');
  } catch {
    logger.warn('Backup manager unavailable');
  }

  // ── Self-Evolution Helpers ──

  /** Run Curator consolidation on a session transcript. */
  async function runCuratorConsolidation(
    sessionId: string,
    transcript: string,
    gw: LLMGateway,
    stm: ShortTermMemory,
    ltm: LongTermMemory,
    pm: ProjectMemory,
    em: EntityMemory,
  ): Promise<void> {
    const prompt = [
      CURATOR_ROLE.systemPrompt,
      '',
      '---',
      '',
      'Analyze this session transcript and extract structured knowledge.',
      '',
      'Session transcript:',
      transcript.slice(0, 8000), // prevent context overflow
      '',
      'Respond with ONLY a JSON object:',
      '{',
      '  "summary": "1-2 sentence summary of what was discussed/decided",',
      '  "topics": ["topic1", "topic2"],',
      '  "memories": [',
      '    {"content": "important fact or insight", "importance": 0.8}',
      '  ],',
      '  "decisions": [',
      '    {"title": "decision made", "outcome": "approved/rejected/pending"}',
      '  ],',
      '  "suggestions": ["actionable follow-up"]',
      '}',
      '',
      'Importance scale: 1.0 = critical knowledge, 0.5 = useful context, 0.1 = low-value.',
      'Return empty arrays if nothing is notable.',
    ].join('\n');

    try {
      const response = await gw.generateText({
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 600,
        temperature: 0.2,
      });

      const match = response.content.match(/\{[\s\S]*\}/);
      if (!match) return;
      const parsed = JSON.parse(match[0]);

      // Embedding helper: try to generate embeddings, fall back to none
      async function embed(content: string): Promise<number[] | undefined> {
        try {
          const result = await gw.generateEmbeddings({ texts: [content] });
          return result.embeddings[0];
        } catch {
          return undefined;
        }
      }

      // Store extracted memories
      for (const mem of parsed.memories ?? []) {
        if (mem.content && mem.content.length > 10) {
          const embedding = await embed(mem.content);
          await ltm.store({
            content: mem.content,
            metadata: {
              sessionId,
              source: 'curator_nudge',
              importance: mem.importance ?? 0.5,
              topics: parsed.topics ?? [],
            },
            embedding,
            timestamp: new Date(),
          });
        }
      }

      // Store the summary
      if (parsed.summary) {
        const summaryEmbedding = await embed(parsed.summary);
        await ltm.store({
          content: `[Session Summary] ${parsed.summary}`,
          metadata: { sessionId, source: 'curator_summary', importance: 1.0 },
          embedding: summaryEmbedding,
          timestamp: new Date(),
        });
      }

      // Update project memory with decisions
      if (parsed.decisions?.length > 0 && pm) {
        for (const dec of parsed.decisions) {
          if (dec.title) {
            pm.addDecision('default', dec.title, dec.outcome ?? 'pending');
          }
        }
      }

      // Update entity memory with learned preferences
      if (parsed.suggestions?.length > 0) {
        const existing = em.getPreferences('captain-1');
        const existingPrefs = existing?.preferences ?? {};
        const learned = (existingPrefs.learnedPatterns as string[]) ?? [];
        for (const s of parsed.suggestions) {
          if (!learned.includes(s)) learned.push(s);
        }
        // Keep only last 20 patterns
        em.setPreferences('captain-1', 'Captain', {
          ...existingPrefs,
          learnedPatterns: learned.slice(-20),
          lastNudgedAt: new Date().toISOString(),
        });
      }

      // Clean up short-term
      stm.clear(sessionId);

      logger.info('Curator consolidation completed', {
        sessionId,
        memories: parsed.memories?.length ?? 0,
        decisions: parsed.decisions?.length ?? 0,
      });
    } catch (e: any) {
      logger.warn('Curator consolidation LLM call failed', { error: e.message });
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
      }
    },
    30 * 60 * 1000,
  );
  consolidationTimer.unref();
  logger.info('Basic memory consolidation scheduled (30min)');

  // Observability daily snapshot persistence (every 6 hours)
  const observabilityTimer = setInterval(
    () => {
      try {
        const now = new Date();
        const summary = metrics.getSummary();
        db.prepare(
          "INSERT INTO metrics (name, value, tags) VALUES ('observability_snapshot', ?, ?)",
        ).run(
          JSON.stringify(summary),
          JSON.stringify({ date: now.toISOString().slice(0, 10), type: 'daily' }),
        );
      } catch (e: any) {
        logger.warn('Observability snapshot failed', { error: e.message });
      }
    },
    6 * 60 * 60 * 1000,
  );
  observabilityTimer.unref();
  logger.info('Observability persistence scheduled (6h)');

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
              await runCuratorConsolidation(
                s.id,
                messages,
                gateway,
                shortTerm,
                longTerm,
                project,
                entity,
              );
            }
          }
        }
      } catch (e: any) {
        logger.warn('Curator nudge failed', { error: e.message });
      }
    },
    4 * 60 * 60 * 1000,
  );
  curatorNudgeTimer.unref();
  logger.info('Curator self-nudge scheduled (4h)');

  // Shared agent registry (custom roles persist across requests)
  const agentRegistry = new AgentRoleRegistry();

  // ── Feedback Loop ──

  const modelRouter = new ModelRouter();

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
      payload: { ...action, type: 'adjustment_pending' as const } as Record<string, unknown>,
    });
    return true;
  };

  const autoAdjuster = new AutoAdjuster(
    observability,
    modelRouter,
    agentRegistry,
    eventBus,
    adjustmentNotifyCallback,
  );

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
      }
    },
    60 * 60 * 1000,
  );
  autoAdjustTimer.unref();
  logger.info('Auto-adjustment health check scheduled (1h)');

  const shutdown = () => {
    logger.info('Shutting down server context...');
    clearInterval(consolidationTimer);
    clearInterval(observabilityTimer);
    clearInterval(curatorNudgeTimer);
    clearInterval(autoAdjustTimer);
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

  ctx = {
    db,
    decisionRepo,
    orgRepo,
    projectRepo,
    eventRepo,
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
    delegationTier: currentTier,
    agentRegistry,
    observability,
    modelRouter,
    autoAdjuster,
    eventBus,
    metrics,
    logger,
    backupManager,
    shutdown,
  };

  return ctx;
}
