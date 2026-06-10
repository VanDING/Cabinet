// Agent factory — AgentLoop creation, caching, rules loading, tier sync.
// Extracted from agents.ts.

// Agent factory, dispatch functions — extracted from secretary.ts (Phase 1.1 split).

import { AsyncLocalStorage } from 'node:async_hooks';
import type { ServerContext } from '../../../context.js';
import { getServerContext, onTierChange } from '../../../context.js';
import { DEFAULT_CAPTAIN_ID, MessageType, type DelegationTier } from '@cabinet/types';
import {
  AgentLoop,
  SafetyChecker,
  CheckpointManager,
  AgentRoleRegistry,
  RulesLoader,
  OrganizeInteractiveAgent,
  CliAdapter,
  A2AConnector,
} from '@cabinet/agent';
import type { AgentRoleType, InteractiveSubAgent } from '@cabinet/agent';
import {
  SecretaryAgent,
  IntentParser,
  type FeedbackStore,
  type ParsedIntent,
  type AgentRouteResult,
} from '@cabinet/secretary';
import { broadcast } from '../../../ws/handler.js';
import { chunkText, cosineSimilarity } from '../../../utils/text-utils.js';
import {
  createStandardToolExecutor,
  createStandardMemoryProvider,
} from '../../../agent-factory.js';
import { buildEnvironmentSection } from '../../../capabilities.js';
import { EvaluationResultRepository } from '@cabinet/storage';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

// Shared sub-module imports
import { execAsync, ROLES_NEEDING_ENV, loadCabinetMd, buildSystemPrompt } from '../utils.js';
import { buildToolDependencies } from '../tool-dependencies.js';

import { feedbackStore } from './feedback.js';

// Lazy reference to dispatchToSpecialistStreaming — avoids circular import with dispatch.ts
let _dispatchToSpecialistStreaming: ((...args: any[]) => any) | undefined;
export function _setDispatchStreamingRef(fn: typeof _dispatchToSpecialistStreaming) {
  _dispatchToSpecialistStreaming = fn;
}
function getDispatchStreaming() {
  return _dispatchToSpecialistStreaming;
}
// ── Multi-agent cache (keyed by sessionId:roleType) ──
export const agentLoopCache = new Map<string, AgentLoop>();
const MAX_CACHE_SIZE = 100;
// Per-session secretary agents (keyed by sessionId)
export const secretaryAgentCache = new Map<string, SecretaryAgent>();
export const secretaryAgentLoopCache = new Map<string, AgentLoop>();
// Reviewer AgentLoop cache (keyed by delegation tier)
export const reviewerLoopCache = new Map<string, AgentLoop>();
const REVIEWER_CACHE_SIZE = 20;
let lastGatewayCheck = false;

// Per-session trust level overrides (detected from natural language)
export const sessionTrustLevel = new Map<string, import('@cabinet/agent').TrustLevel>();

export function detectTrustLevelOverride(msg: string): import('@cabinet/agent').TrustLevel | null {
  const lower = msg.toLowerCase();
  if (
    lower.includes('允许你多尝试几次') ||
    lower.includes('放手去做') ||
    lower.includes('大胆尝试')
  )
    return 'T2';
  if (lower.includes('谨慎处理') || lower.includes('不要擅自') || lower.includes('小心'))
    return 'T0';
  if (lower.includes('完全信任') || lower.includes('调试模式') || lower.includes('debug'))
    return 'T3';
  return null;
}

// Keep cached agent loops in sync with delegation tier changes from the UI
onTierChange((tier: DelegationTier) => {
  for (const loop of agentLoopCache.values()) {
    try {
      loop.setDelegationTier(tier);
    } catch {
      /* non-fatal */
    }
  }
  for (const agent of secretaryAgentCache.values()) {
    try {
      agent.setDelegationTier(tier);
    } catch {
      /* non-fatal */
    }
  }
});

export function buildRulesLoader(projectRootPath?: string) {
  const dirs: string[] = [];
  const homeRules = join(homedir(), '.cabinet', 'rules');
  if (existsSync(homeRules)) dirs.push(homeRules);
  if (projectRootPath) {
    const projectRules = join(projectRootPath, '.cabinet', 'rules');
    if (existsSync(projectRules)) dirs.push(projectRules);
  }
  const globalFile = join(homedir(), '.cabinet', 'CABINET.md');
  return new RulesLoader(dirs, existsSync(globalFile) ? globalFile : undefined);
}

/** Resolve a role's modelTier to the actual model via user-configured modelMapping. */
export function resolveModel(role: { modelTier: string }): string {
  const ctx = getServerContext();
  const adapter = ctx.gateway as { resolveModelString?: (t: string) => string };
  if (adapter?.resolveModelString) {
    return adapter.resolveModelString(role.modelTier);
  }
  return role.modelTier;
}

/** Get or create an AgentLoop for a specific role. */
export function getAgentLoopForRole(
  roleType: AgentRoleType,
  sessionId: string,
  projectId: string,
  captainId: string,
  thinkingBudget?: number,
  model?: string,
  memorySessionId?: string,
): AgentLoop | null {
  const ctx = getServerContext();
  if (!ctx.gateway) return null;

  // Return cached if available (keyed by sessionId:projectId:roleType)
  const cacheKey = `${sessionId}:${projectId}:${roleType}`;
  const cached = agentLoopCache.get(cacheKey);
  if (cached) return cached;

  const registry = getServerContext().agentRegistry;
  const role = registry.get(roleType);
  if (!role) return null;

  // ── Employee config override (for custom agents) ──
  let effectiveModel = model;
  let effectiveTemperature = role.temperature;
  let effectiveMaxResponseTokens = role.maxResponseTokens;
  let effectiveSystemPrompt = role.modules.identity;
  let effectiveAllowedTools = role.allowedTools;

  if (role.type === 'custom') {
    const emp = ctx.employeeRepo.findAll().find((e) => e.name === role.name && e.kind === 'ai');
    if (emp) {
      const pipeline = (() => {
        try {
          return JSON.parse(emp.pipeline_config ?? '{}');
        } catch {
          return {};
        }
      })();
      const empAllowedTools = (() => {
        try {
          return JSON.parse(emp.allowed_tools ?? '[]');
        } catch {
          return [];
        }
      })();

      if (!effectiveModel && pipeline.model) {
        effectiveModel = pipeline.model;
      }
      if (pipeline.temperature !== undefined) {
        effectiveTemperature = pipeline.temperature;
      }
      if (pipeline.maxTokens !== undefined) {
        effectiveMaxResponseTokens = pipeline.maxTokens;
      }
      if (pipeline.systemPrompt) {
        effectiveSystemPrompt = pipeline.systemPrompt;
      }
      if (empAllowedTools.length > 0) {
        effectiveAllowedTools = empAllowedTools;
      }
    }
  }

  const executor = createStandardToolExecutor(
    ctx,
    buildToolDependencies(ctx, projectId === 'global' ? undefined : projectId, {
      getAgentLoopForRole,
      resolveModel,
    }),
    effectiveAllowedTools,
  );

  // Look up project root path for the system prompt
  let projectRootPath: string | undefined;
  try {
    const projRow = ctx.projectRepo.findById(projectId);
    if (projRow?.rootPath && existsSync(projRow.rootPath)) {
      projectRootPath = projRow.rootPath;
    }
  } catch {
    /* best-effort */
  }

  // Load project-level skills for this session's project
  if (projectRootPath) {
    ctx.skillRegistry.clearProjectSkills();
    const projectSkillsDir = join(projectRootPath, '.cabinet', 'skills');
    if (existsSync(projectSkillsDir)) {
      ctx.skillRegistry.loadFromDirectory(projectSkillsDir, 'project');
    }
  }

  const checkpointManager = new CheckpointManager(ctx.db);
  const rulesLoader = buildRulesLoader(projectRootPath);
  const loop = new AgentLoop({
    costTracker: ctx.costTracker,
    gateway: ctx.gateway,
    toolExecutor: executor,
    safetyChecker: (() => {
      const s = new SafetyChecker(ctx.delegationTier);
      s.setMcpRiskResolver((name) => ctx.mcpManager.getToolRisk(name));
      return s;
    })(),
    checkpointManager,
    memoryProvider: createStandardMemoryProvider(ctx, projectId),
    rulesLoader,
    sessionId: `${sessionId}-${role.type}`,
    memorySessionId: memorySessionId ?? sessionId,
    projectId,
    captainId,
    roleModules: { identity: buildSystemPrompt(role.type, effectiveSystemPrompt, projectRootPath) },
    model: effectiveModel ?? resolveModel(role),
    maxSteps: role.maxSteps ?? 50,
    maxResponseTokens: effectiveMaxResponseTokens,
    temperature: effectiveTemperature,
    contextBudget: role.contextBudget,
    thinkingBudget,
    trustLevel: sessionTrustLevel.get(sessionId) ?? undefined,
    blackboard: ctx.blackboard,
    mcpResources: ctx.mcpManager.listResources().map((r) => ({ uri: r.uri, name: r.name, description: r.description })),
    mcpPrompts: ctx.mcpManager.listPrompts().map((p) => ({ name: p.name, description: p.description })),
    // toolPruner removed from ServerContext — fixed small tool set
  });

  // FIFO eviction
  if (agentLoopCache.size >= MAX_CACHE_SIZE) {
    const firstKey = agentLoopCache.keys().next().value;
    if (firstKey) agentLoopCache.delete(firstKey);
  }
  // Wire observability + skill extraction on session completion
  loop.onSessionComplete = (summary) => {
    const ctx = getServerContext();
    ctx.observability.recordSession({
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

    // Auto-extract skill from successful complex sessions
    ctx.skillExtractor
      .extract(summary)
      .then((skill) => {
        if (skill) {
          const quality = ctx.skillExtractor.scoreSkillQuality(skill);
          const path = ctx.skillExtractor.save(skill, quality);
          ctx.logger.info('Auto-skill extracted', { name: skill.name, path });
        }
      })
      .catch((err) => {
        console.warn('Operation failed', err);
      });

    // Subconscious loop tick — write insights to blackboard for next session context
    if (ctx.subconsciousLoop && ctx.blackboard) {
      ctx.subconsciousLoop
        .tick()
        .then((insights) => {
          for (const insight of insights) {
            ctx.blackboard!.write('insights', insight, summary.sessionId).catch(() => {});
          }
        })
        .catch(() => {});
    }
  };

  agentLoopCache.set(cacheKey, loop);
  return loop;
}

/** Create a fresh (non-cached) Reviewer AgentLoop for quality review tasks. */
export function createReviewerLoop(ctx: ServerContext): AgentLoop | null {
  if (!ctx.gateway) return null;

  const registry = ctx.agentRegistry;
  const role = registry.get('reviewer');
  if (!role) return null;

  // Check cache first
  const cacheKey = `reviewer_${ctx.delegationTier}`;
  const cached = reviewerLoopCache.get(cacheKey);
  if (cached) return cached;

  const executor = createStandardToolExecutor(ctx, buildToolDependencies(ctx), role.allowedTools);

  const checkpointManager = new CheckpointManager(ctx.db);
  const rulesLoader = buildRulesLoader();
  const loop = new AgentLoop({
    costTracker: ctx.costTracker,
    gateway: ctx.gateway,
    toolExecutor: executor,
    safetyChecker: (() => {
      const s = new SafetyChecker(ctx.delegationTier);
      s.setMcpRiskResolver((name) => ctx.mcpManager.getToolRisk(name));
      return s;
    })(),
    checkpointManager,
    memoryProvider: createStandardMemoryProvider(ctx, 'default'),
    rulesLoader,
    sessionId: `reviewer_${Date.now()}`,
    projectId: 'default',
    captainId: DEFAULT_CAPTAIN_ID,
    roleModules: { identity: buildSystemPrompt(role.type, role.modules.identity) },
    model: resolveModel(role),
    maxSteps: role.maxSteps ?? 50,
    maxResponseTokens: role.maxResponseTokens,
    temperature: role.temperature,
    contextBudget: role.contextBudget,
    // toolPruner removed from ServerContext — fixed small tool set
  });

  // FIFO eviction
  if (reviewerLoopCache.size >= REVIEWER_CACHE_SIZE) {
    const firstKey = reviewerLoopCache.keys().next().value;
    if (firstKey) reviewerLoopCache.delete(firstKey);
  }
  reviewerLoopCache.set(cacheKey, loop);
  return loop;
}
/** Persist review result to evaluation_results table. */
export function persistReviewResult(
  ctx: ServerContext,
  sourceType: string,
  sourceId: string,
  review: { pass: boolean; score: number; issues: any[] },
): void {
  try {
    new EvaluationResultRepository(ctx.db).insert({
      project_id: null,
      session_id: null,
      source_type: sourceType,
      source_id: sourceId,
      overall_score: review.score ?? 0,
      dimensions: JSON.stringify({ pass: review.pass, issues: review.issues ?? [] }),
      feedback: null,
      evaluator_model: 'claude-haiku-4-5',
    });
  } catch {
    /* persistence failure is non-fatal */
  }
}

export function getOrCreateAgent(
  sessionId: string,
  projectId: string,
  captainId: string,
  model?: string,
  thinkingBudget?: number,
) {
  const ctx = getServerContext();
  const hasGateway = ctx.gateway !== null;

  // Reset cache if gateway status changed
  if (hasGateway !== lastGatewayCheck) {
    agentLoopCache.clear();
    secretaryAgentCache.clear();
    lastGatewayCheck = hasGateway;
  }

  const cacheKey = `${sessionId}:${projectId}`;
  const cached = secretaryAgentCache.get(cacheKey);
  if (cached) {
    return { agent: cached, agentLoop: secretaryAgentLoopCache.get(cacheKey) ?? null };
  }

  // Secretary's own executor (all tools)
  const executor = createStandardToolExecutor(
    ctx,
    buildToolDependencies(ctx, projectId === 'global' ? undefined : projectId, {
      getAgentLoopForRole,
      resolveModel,
    }),
  );
  const memoryProvider = createStandardMemoryProvider(ctx, projectId);

  // Load secretary role for temperature and system prompt
  const secretaryRole = ctx.agentRegistry.get('secretary');

  let secretaryLoop: AgentLoop | null = null;
  if (hasGateway) {
    // Look up project root path for the system prompt
    let projectRootPath: string | undefined;
    try {
      if (projectId && projectId !== 'global') {
        const projRow = ctx.projectRepo.findById(projectId);
        if (projRow?.rootPath && existsSync(projRow.rootPath)) {
          projectRootPath = projRow.rootPath;
        }
      }
    } catch {
      /* best-effort */
    }

    // Load project-level skills for this session's project
    if (projectRootPath) {
      ctx.skillRegistry.clearProjectSkills();
      const projectSkillsDir = join(projectRootPath, '.cabinet', 'skills');
      if (existsSync(projectSkillsDir)) {
        ctx.skillRegistry.loadFromDirectory(projectSkillsDir, 'project');
      }
    }

    const checkpointManager = new CheckpointManager(ctx.db);
    const rulesLoader = buildRulesLoader(projectRootPath);
    secretaryLoop = new AgentLoop({
      costTracker: ctx.costTracker,
      gateway: ctx.gateway!,
      toolExecutor: executor,
      safetyChecker: (() => {
        const s = new SafetyChecker(ctx.delegationTier);
        s.setMcpRiskResolver((name) => ctx.mcpManager.getToolRisk(name));
        return s;
      })(),
      checkpointManager,
      memoryProvider,
      rulesLoader,
      sessionId,
      projectId,
      captainId,
      systemPrompt: (() => {
        const base = buildSystemPrompt(
          'secretary',
          secretaryRole?.modules.identity ?? '',
          projectRootPath,
        );
        const skillList = ctx.skillRegistry.describeForRouting();
        if (!skillList) return base;
        return `${base}\n\n## Available Skills\nYou can invoke any of the following skills using the /skillName command or the use_skill tool:\n${skillList}`;
      })(),
      model: model ?? resolveModel(secretaryRole ?? { modelTier: 'default' }),
      maxSteps: secretaryRole?.maxSteps ?? 50,
      maxResponseTokens: secretaryRole?.maxResponseTokens,
      temperature: secretaryRole?.temperature ?? 0.5,
      contextBudget: secretaryRole?.contextBudget,
      thinkingBudget,
      trustLevel: sessionTrustLevel.get(sessionId) ?? undefined,
      // toolPruner removed from ServerContext — fixed small tool set
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

      // Subconscious loop tick — write insights to blackboard for next session context
      const serverCtx = getServerContext();
      if (serverCtx.subconsciousLoop && serverCtx.blackboard) {
        serverCtx.subconsciousLoop
          .tick()
          .then((insights) => {
            for (const insight of insights) {
              serverCtx.blackboard!.write('insights', insight, summary.sessionId).catch(() => {});
            }
          })
          .catch(() => {});
      }
    };
  }

  const intentParser = ctx.intentParser ?? new IntentParser(hasGateway ? ctx.gateway! : undefined);

  // Initialize the router with agent descriptions and valid types (includes custom agents)
  const registry = getServerContext().agentRegistry;
  intentParser.setAgentDescriptions(registry.describeForRouting());
  intentParser.setValidAgentTypes(registry.getValidAgentTypes());
  // Register custom agents for fallback routing by name/description match
  const customAgents = new Map<
    string,
    { description: string; keywords?: string[]; aliases?: string[] }
  >();
  for (const role of registry.list()) {
    if (role.type === 'custom') {
      customAgents.set(role.name, {
        description: role.description,
        keywords: role.keywords,
        aliases: role.aliases,
      });
    }
  }
  intentParser.setCustomAgents(customAgents);
  // Inject captain preferences for personalized routing
  try {
    const captainPrefs = ctx.entity.getPreferences(captainId);
    if (captainPrefs?.preferences) {
      const prefs = captainPrefs.preferences;
      const prefLines: string[] = [];
      if (prefs.riskTolerance) prefLines.push(`- Risk tolerance: ${prefs.riskTolerance}`);
      if (prefs.costSensitivity) prefLines.push(`- Cost sensitivity: ${prefs.costSensitivity}`);
      if (prefs.timeUrgency) prefLines.push(`- Time urgency: ${prefs.timeUrgency}`);
      if (prefs.preferredDecisionStyle)
        prefLines.push(`- Decision style: ${prefs.preferredDecisionStyle}`);
      if (prefLines.length > 0) {
        intentParser.setCaptainPreferences(prefLines.join('\n'));
      }
    }
  } catch {
    /* preferences not available — routing works without */
  }

  // Warm up embeddings eagerly so the first request doesn't pay the latency cost
  if (hasGateway) {
    intentParser.warmupEmbeddings().catch((err) => {
      console.warn('Operation failed', err);
    });
  }

  const agent = new SecretaryAgent(
    secretaryLoop ?? (null as unknown as import('@cabinet/agent').AgentLoop),
    intentParser,
    ctx.sessionManager,
    ctx.gateway ?? undefined,
    // dispatchToRole callback: routes to specialist agents with streaming
    async (
      roleType: AgentRoleType,
      msg: string,
      sid: string,
      callback: import('@cabinet/agent').StreamingCallback,
    ) => {
      await getDispatchStreaming()!(
        roleType,
        msg,
        sid,
        projectId,
        captainId,
        callback,
        thinkingBudget,
        model ?? undefined,
      );
    },
    feedbackStore,
  );

  // FIFO eviction for secretary cache
  if (secretaryAgentCache.size >= MAX_CACHE_SIZE) {
    const firstKey = secretaryAgentCache.keys().next().value;
    if (firstKey) secretaryAgentCache.delete(firstKey);
  }
  secretaryAgentCache.set(cacheKey, agent);
  if (secretaryLoop) {
    secretaryAgentLoopCache.set(cacheKey, secretaryLoop);
  }

  return { agent, agentLoop: secretaryLoop };
}
