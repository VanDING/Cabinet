import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AgentLoop, SafetyChecker, CheckpointManager, AgentRoleRegistry } from '@cabinet/agent';
import type { AgentRoleType } from '@cabinet/agent';
import { DEFAULT_CAPTAIN_ID, type DelegationTier } from '@cabinet/types';
import { getServerContext, onTierChange } from '../../../../context.js';
import {
  createStandardToolExecutor,
  createStandardMemoryProvider,
} from '../../../../agent-factory.js';
import { buildToolDependencies } from '../../tool-dependencies.js';
import { buildSystemPrompt } from '../../utils.js';
import { buildRulesLoader } from './rules.js';
import { resolveModel } from './model.js';
import {
  agentLoopCache,
  secretaryAgentCache,
  reviewerLoopCache,
  MAX_CACHE_SIZE,
  REVIEWER_CACHE_SIZE,
  sessionTrustLevel,
} from './shared.js';

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
    const emp = ctx.employeeRepo
      .findAll()
      .find((e: any) => e.name === role.name && e.kind === 'ai');
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
      s.setMcpRiskResolver((name: string) => ctx.mcpManager.getToolRisk(name));
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
    mcpResources: ctx.mcpManager
      .listResources()
      .map((r: any) => ({ uri: r.uri, name: r.name, description: r.description })),
    mcpPrompts: ctx.mcpManager
      .listPrompts()
      .map((p: any) => ({ name: p.name, description: p.description })),
    // toolPruner removed from ServerContext — fixed small tool set
  });

  // FIFO eviction
  if (agentLoopCache.size >= MAX_CACHE_SIZE) {
    const firstKey = agentLoopCache.keys().next().value;
    if (firstKey) agentLoopCache.delete(firstKey);
  }
  // Wire observability + skill extraction on session completion
  loop.onSessionComplete = (summary: any) => {
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
      .then((skill: any) => {
        if (skill) {
          const quality = ctx.skillExtractor.scoreSkillQuality(skill);
          const path = ctx.skillExtractor.save(skill, quality);
          ctx.logger.info('Auto-skill extracted', { name: skill.name, path });
        }
      })
      .catch((err: any) => {
        console.warn('Operation failed', err);
      });

    // Subconscious loop tick — write insights to blackboard for next session context
    if (ctx.subconsciousLoop && ctx.blackboard) {
      ctx.subconsciousLoop
        .tick()
        .then((insights: any[]) => {
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
export function createReviewerLoop(
  ctx: import('../../../../context.js').ServerContext,
): AgentLoop | null {
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
