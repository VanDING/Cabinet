import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateText } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { AgentLoop, SafetyChecker, CheckpointManager } from '@cabinet/agent';
import type { AgentRoleType, ToolResult } from '@cabinet/agent';
import { SecretaryAgent, type AgentRunner, IntentParser } from '@cabinet/secretary';
import { getServerContext } from '../../../../context.js';
import {
  createStandardToolExecutor,
  createStandardMemoryProvider,
} from '../../../../agent-factory.js';
import { buildToolDependencies } from '../../tool-dependencies.js';
import { buildSystemPrompt } from '../../utils.js';
import { feedbackStore } from '../feedback.js';
import { resolveModel } from './model.js';
import { getAgentLoopForRole } from './loops.js';
import { buildRulesLoader } from './rules.js';
import {
  agentLoopCache,
  secretaryAgentCache,
  secretaryAgentLoopCache,
  MAX_CACHE_SIZE,
  sessionTrustLevel,
  getDispatchStreaming,
} from './shared.js';

let lastGatewayCheck = false;

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
      roleModules: {
        identity: buildSystemPrompt(
          'secretary',
          secretaryRole?.modules.identity ?? '',
          projectRootPath,
        ),
        workflow: secretaryRole?.modules.workflow,
      },
      model: model ?? resolveModel(secretaryRole ?? { modelTier: 'default' }),
      maxSteps: secretaryRole?.maxSteps ?? 50,
      maxResponseTokens: secretaryRole?.maxResponseTokens,
      temperature: secretaryRole?.temperature ?? 0.5,
      contextBudget: secretaryRole?.contextBudget,
      thinkingBudget,
      trustLevel: sessionTrustLevel.get(sessionId) ?? undefined,
      observerPreset: 'minimal',
      // toolPruner removed from ServerContext — fixed small tool set
    });
    secretaryLoop.onSessionComplete = (summary: any) => {
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
          .then((insights: any[]) => {
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
    intentParser.warmupEmbeddings().catch((err: any) => {
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
