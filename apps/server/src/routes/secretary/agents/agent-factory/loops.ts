import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  AgentLoop,
  SafetyChecker,
  CheckpointManager,
  AgentRoleRegistry,
  SdkAgentLoopAdapter,
} from '@cabinet/agent';
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
      (loop as any).setDelegationTier?.(tier);
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

/** Get or create an agent (SDK adapter or legacy AgentLoop) for a specific role. */
export function getAgentLoopForRole(
  roleType: AgentRoleType,
  sessionId: string,
  projectId: string,
  captainId: string,
  thinkingBudget?: number,
  model?: string,
  memorySessionId?: string,
): any {
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

  // Build tool dependencies for the SDK adapter
  const toolDeps = buildToolDependencies(ctx, projectId === 'global' ? undefined : projectId, {
    getAgentLoopForRole: ((
      roleType: any,
      sessionId: any,
      projectId: any,
      captainId: any,
      thinkingBudget?: number,
      model?: string,
      memorySessionId?: string,
    ) =>
      getAgentLoopForRole(
        roleType,
        sessionId,
        projectId,
        captainId,
        thinkingBudget,
        model,
        memorySessionId,
      )) as any,
    resolveModel,
  });

  const instructions = buildSystemPrompt(role.type, effectiveSystemPrompt, projectRootPath);

  // Add MCP resource/prompt context to instructions
  const mcpResources = ctx.mcpManager.listResources() as any[];
  const mcpPrompts = ctx.mcpManager.listPrompts() as any[];
  const mcpContext = [
    ...(mcpResources.length > 0
      ? ['Available MCP resources:', ...mcpResources.map((r: any) => `- ${r.name}: ${r.uri}`)]
      : []),
    ...(mcpPrompts.length > 0
      ? ['Available MCP prompts:', ...mcpPrompts.map((p: any) => `- ${p.name}: ${p.description}`)]
      : []),
  ].join('\n');
  const fullInstructions = mcpContext ? `${instructions}\n\n${mcpContext}` : instructions;

  const loop = new SdkAgentLoopAdapter(toolDeps, {
    instructions: fullInstructions,
    model: effectiveModel ?? resolveModel(role),
    temperature: effectiveTemperature,
    maxResponseTokens: effectiveMaxResponseTokens,
    maxSteps: role.maxSteps ?? 50,
    allowedTools: effectiveAllowedTools,
  });

  // Cache for reuse
  if (agentLoopCache.size >= MAX_CACHE_SIZE) {
    const firstKey = agentLoopCache.keys().next().value;
    if (firstKey) agentLoopCache.delete(firstKey);
  }
  agentLoopCache.set(cacheKey, loop);
  return loop;
}

/** Create a fresh (non-cached) Reviewer agent for quality review tasks. */
export function createReviewerLoop(ctx: import('../../../../context.js').ServerContext): any {
  if (!ctx.gateway) return null;

  const registry = ctx.agentRegistry;
  const role = registry.get('reviewer');
  if (!role) return null;

  const cacheKey = `reviewer_${ctx.delegationTier}`;
  const cached = reviewerLoopCache.get(cacheKey);
  if (cached) return cached;

  const toolDeps = buildToolDependencies(ctx, undefined, {
    getAgentLoopForRole: ((
      roleType: any,
      sessionId: any,
      projectId: any,
      captainId: any,
      thinkingBudget?: number,
      model?: string,
      memorySessionId?: string,
    ) => {
      try {
        return getAgentLoopForRole(
          roleType,
          sessionId,
          projectId,
          captainId,
          thinkingBudget,
          model,
          memorySessionId,
        );
      } catch {
        return null;
      }
    }) as any,
    resolveModel,
  });

  const instructions = buildSystemPrompt(role.type, role.modules.identity);

  const loop = new SdkAgentLoopAdapter(toolDeps, {
    instructions,
    model: resolveModel(role),
    temperature: role.temperature,
    maxResponseTokens: role.maxResponseTokens,
    maxSteps: role.maxSteps ?? 50,
  });

  if (reviewerLoopCache.size >= REVIEWER_CACHE_SIZE) {
    const firstKey = reviewerLoopCache.keys().next().value;
    if (firstKey) reviewerLoopCache.delete(firstKey);
  }
  reviewerLoopCache.set(cacheKey, loop);
  return loop;
}
