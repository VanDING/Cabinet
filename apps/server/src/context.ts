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
import {
  createConnection,
  runMigration001,
  runMigration002,
  runMigration003,
  DecisionRepository,
  ProjectRepository,
  EventLogRepository,
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
import { AgentRoleRegistry, CURATOR_ROLE, SkillRegistry, importSkillFromMarkdown } from '@cabinet/agent';
import { MCPManager } from './mcp/mcp-manager.js';
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
  // Skill registry (shared — loaded from DB on startup)
  skillRegistry: import('@cabinet/agent').SkillRegistry;
  mcpManager: import('./mcp/mcp-manager.js').MCPManager;
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

  // Database — use ~/.cabinet/ (cross-platform user data directory)
  const dataDir = ensureCabinetDir();
  const dbPath = join(dataDir, 'cabinet.db');

  let db: Database;
  try {
    db = createConnection(dbPath);
    runMigration001(db);
    runMigration002(db);
    runMigration003(db);
    logger.info('SQLite database initialized', { path: dbPath });
  } catch (e) {
    logger.error('Failed to initialize SQLite', { error: String(e) });
    try {
      db = createConnection(':memory:');
      runMigration001(db);
      runMigration002(db);
      runMigration003(db);
      logger.warn('Falling back to in-memory database');
    } catch (e2) {
      logger.error('SQLite completely unavailable — running without persistence', {
        error: String(e2),
      });
      db = createConnection(':memory:');
    }
  }

  // Seed default projects so foreign-key references resolve
  db.exec(`
    INSERT OR IGNORE INTO projects (id, name, description) VALUES ('proj-1', 'Default Project', 'Auto-seeded default project');
    INSERT OR IGNORE INTO projects (id, name, description) VALUES ('default', 'Default', 'Auto-seeded fallback project');
  `);

  // Repositories
  const decisionRepo = new DecisionRepository(db);
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

  // Backup (to ~/.cabinet/backups)
  let backupManager: BackupManager | null = null;
  try {
    backupManager = new BackupManager({
      dbPath,
      backupDir: join(dataDir, 'backups'),
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
  // Load custom agents from DB
  try {
    const customRows = db.prepare("SELECT * FROM agent_roles WHERE is_builtin = 0").all() as any[];
    for (const row of customRows) {
      agentRegistry.register({
        type: 'custom' as const,
        name: row.name,
        description: row.description,
        systemPrompt: row.system_prompt,
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
    const skillRows = db.prepare("SELECT * FROM skills WHERE status = 'active'").all() as any[];
    for (const row of skillRows) {
      skillRegistry.register({
        id: row.id,
        name: row.name,
        description: row.description,
        kind: row.kind,
        promptTemplate: row.prompt_template,
        inputSchema: JSON.parse(row.input_schema ?? '{}'),
        outputSchema: JSON.parse(row.output_schema ?? '{}'),
        version: row.version,
        status: row.status,
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
      const row = db.prepare("SELECT value FROM settings WHERE key = 'mcp_servers'").get() as any;
      const dbConfigs: import('./mcp/mcp-manager.js').MCPServerConfig[] = JSON.parse(row?.value ?? '[]');
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
            const existing = db.prepare('SELECT id FROM skills WHERE name = ?').get(result.name) as any;
            if (!existing) {
              const skill = skillRegistry.load(result.name);
              if (skill) {
                db.prepare(
                  `INSERT OR IGNORE INTO skills (id, name, description, kind, input_schema, output_schema, prompt_template, version, status)
                   VALUES (?, ?, ?, ?, '{}', '{}', ?, 1, 'active')`,
                ).run(skill.id, skill.name, skill.description, skill.kind, skill.promptTemplate);
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
          const existing = db.prepare('SELECT type FROM agent_roles WHERE name = ? AND is_builtin = 0').get(name) as any;
          if (!existing) {
            agentRegistry.register({
              type: 'custom' as const,
              name,
              description: agentCard.description ?? '',
              systemPrompt: agentCard.systemPrompt ?? agentCard.instructions ?? '',
              model: agentCard.model ?? agentCard.defaultModel ?? 'claude-sonnet-4-6',
              temperature: agentCard.temperature ?? 0.7,
              maxResponseTokens: agentCard.maxResponseTokens ?? agentCard.maxTokens ?? 4096,
              allowedTools: agentCard.allowedTools ?? [],
              contextBudget: agentCard.contextBudget ?? agentCard.contextWindow ?? 100000,
            });
            db.prepare(
              `INSERT OR IGNORE INTO agent_roles (type, name, description, system_prompt, model, temperature, max_response_tokens, allowed_tools, context_budget, is_builtin)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
            ).run(
              'custom', name,
              agentCard.description ?? '',
              agentCard.systemPrompt ?? agentCard.instructions ?? '',
              agentCard.model ?? agentCard.defaultModel ?? 'claude-sonnet-4-6',
              agentCard.temperature ?? 0.7,
              agentCard.maxResponseTokens ?? agentCard.maxTokens ?? 4096,
              JSON.stringify(agentCard.allowedTools ?? []),
              agentCard.contextBudget ?? agentCard.contextWindow ?? 100000,
            );
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
          const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(proj.id) as any;
          if (!existing) {
            db.prepare(
              `INSERT INTO projects (id, name, description, root_path, last_activity_at)
               VALUES (?, ?, ?, ?, ?)`,
            ).run(proj.id, proj.name, proj.description ?? '', proj.rootPath ?? '', proj.lastActivityAt ?? new Date().toISOString());
            db.prepare('INSERT INTO project_context (project_id, summary) VALUES (?, ?)').run(proj.id, '');
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
          db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('mcp_servers', ?)").run(
            JSON.stringify(settings.mcpServers),
          );
        }
        if (settings.delegationTier) {
          setCurrentTier(settings.delegationTier as DelegationTier);
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
    skillRegistry,
    mcpManager,
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
