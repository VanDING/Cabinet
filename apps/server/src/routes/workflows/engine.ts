/* eslint-disable @typescript-eslint/no-explicit-any */
import { getServerContext } from '../../context.js';
import { broadcast } from '../../ws/handler.js';
import {
  WorkflowEngine,
  type WorkflowNodeDef,
  type WorkflowRun,
  type AgentLoopHandle,
} from '@cabinet/workflow';
import { DEFAULT_CAPTAIN_ID } from '@cabinet/types';
import {
  AgentLoop,
  ToolExecutor,
  SafetyChecker,
  CheckpointManager,
  registerCabinetTools,
  registerSkillTools,
  registerMCPTools,
  CliAdapter,
  A2AConnector,
} from '@cabinet/agent';
import { buildEnvironmentSection } from '../../capabilities.js';
import {
  toolExecutorCache,
  agentLoopPool,
  AGENT_LOOP_POOL_MAX,
  pendingCapabilities,
} from './state.js';
import { buildToolDependencies } from './tool-deps.js';

// ── Workflow memory provider (per-run isolation) ──
export function buildWorkflowMemoryProvider(runId: string) {
  const ctx = getServerContext();
  return {
    async getShortTerm(_sid: string) {
      return [];
    },
    async getProjectContext(_pid: string) {
      const projCtx = ctx.project.get(_pid);
      if (!projCtx) return `Cabinet v2.0 project. ${_pid}`;
      return `Project: ${projCtx.summary}\nGoals: ${projCtx.goals.join(', ')}`;
    },
    async getEntityPreferences(_captainId: string) {
      const prefs = ctx.entity.getPreferences(_captainId);
      return prefs?.preferences ?? {};
    },
    async searchLongTerm(query: string, _pid: string) {
      let queryEmbedding: number[] | undefined;
      if (ctx.gateway) {
        try {
          const er = await ctx.gateway.generateEmbeddings({ texts: [query] });
          queryEmbedding = er.embeddings[0];
        } catch {
          /* fall back to text search */
        }
      }
      const results = await ctx.longTerm.search(query, 5, queryEmbedding);
      return results.map((r) => `[Memory] ${r.content}`);
    },
  };
}

// ── Shared engine instance ──
let engine: WorkflowEngine | null = null;

export function getEngine(): WorkflowEngine {
  if (engine) return engine;
  const ctx = getServerContext();
  engine = new WorkflowEngine();
  engine.setDb(ctx.db);

  engine.setHandlers({
    // ── Segment-based agent execution (new) ──
    createAgentLoop: async (agentId, runId, options): Promise<AgentLoopHandle> => {
      if (!ctx.gateway) throw new Error('No LLM gateway available');

      const registry = ctx.agentRegistry;
      const role = registry.get(agentId);
      if (!role) throw new Error(`Agent not found: ${agentId}`);

      const cacheKey = `${runId}:${agentId}`;

      // Check pool first (persistent agents reuse their instance; default persistent=true)
      if (options.persistent !== false) {
        const cached = agentLoopPool.get(cacheKey);
        if (cached) {
          // Move to end (MRU)
          agentLoopPool.delete(cacheKey);
          agentLoopPool.set(cacheKey, cached);
          return {
            async run(message: string) {
              const result = await cached.run(message);
              return result.content;
            },
            async dispose() {
              cached.resetHandoff();
            },
            async handoff() {
              return cached.generateHandoff();
            },
          };
        }
      }

      // Reuse a cached ToolExecutor for the same capabilities (avoid re-registering all tools)
      const capsKey = JSON.stringify(pendingCapabilities);
      let baseExecutor = toolExecutorCache.get(capsKey);
      if (!baseExecutor) {
        baseExecutor = new ToolExecutor();
        registerCabinetTools(baseExecutor, buildToolDependencies(pendingCapabilities));
        registerSkillTools(baseExecutor);
        const mcpCtx = getServerContext();
        registerMCPTools(
          baseExecutor,
          (name, args, trustLevel) => mcpCtx.mcpManager.callTool(name, args, trustLevel),
          () => mcpCtx.mcpManager.listTools(),
        );
        baseExecutor.setToolCallCallback((toolName, success, blocked, durationMs) => {
          ctx.observability.recordToolCall(toolName, success, blocked, durationMs);
        });
        toolExecutorCache.set(capsKey, baseExecutor);
      }

      // Create a filtered view instead of rebuilding the tool registry
      const executor =
        role.allowedTools.length > 0 ? baseExecutor.createView(role.allowedTools) : baseExecutor;

      const checkpointManager = new CheckpointManager(ctx.db);
      const loop = new AgentLoop({
        gateway: ctx.gateway,
        toolExecutor: executor,
        safetyChecker: (() => {
          const s = new SafetyChecker(ctx.delegationTier);
          s.setMcpRiskResolver((name) => ctx.mcpManager.getToolRisk(name));
          return s;
        })(),
        checkpointManager,
        memoryProvider: buildWorkflowMemoryProvider(runId),
        sessionId: cacheKey,
        projectId: 'default',
        captainId: DEFAULT_CAPTAIN_ID,
        systemPrompt: buildEnvironmentSection() + '\n\n' + role.modules.identity,
        model: (ctx.gateway as any).resolveModelString?.(role.modelTier) ?? role.modelTier,
        maxSteps: options.persistent !== false ? 20 : 50,
        maxResponseTokens: role.maxResponseTokens,
        temperature: role.temperature,
        contextBudget: role.contextBudget,
        toolPruner: undefined, // removed from ServerContext — fixed small tool set
      });

      // Add to pool with LRU eviction
      if (options.persistent !== false) {
        if (agentLoopPool.size >= AGENT_LOOP_POOL_MAX) {
          const firstKey = agentLoopPool.keys().next().value;
          if (firstKey) {
            agentLoopPool.get(firstKey)?.resetHandoff();
            agentLoopPool.delete(firstKey);
          }
        }
        agentLoopPool.set(cacheKey, loop);
      }

      return {
        async run(message: string) {
          const result = await loop.run(message);
          ctx.metrics.increment('llm_call', {
            model: (ctx.gateway as any).resolveModelString?.(role.modelTier) ?? role.modelTier,
            purpose: 'workflow_segment',
          });
          return result.content;
        },
        async dispose() {
          loop.resetHandoff();
          if (options.persistent === false) {
            agentLoopPool.delete(cacheKey);
          }
        },
        async handoff() {
          return loop.generateHandoff();
        },
      };
    },

    // ── Legacy aiAgent handler (fallback for nodes without agentId) ──
    aiAgent: async (node: WorkflowNodeDef, _previousOutputs: string) => {
      if (!ctx.gateway) return 'No LLM available';
      const d = node.data ?? {};
      try {
        const response = await ctx.gateway.generateText({
          model: (d.model as string) ?? 'claude-haiku-4-5',
          messages: [
            {
              role: 'user',
              content: (d.prompt as string) ?? (d.label as string) ?? 'Process this step',
            },
          ],
          maxTokens: (d.maxTokens as number) ?? 200,
        });
        ctx.metrics.increment('llm_call', {
          model: (d.model as string) ?? 'claude-haiku-4-5',
          purpose: 'workflow_legacy',
        });
        return response.content;
      } catch (e: any) {
        return `Error: ${e.message}`;
      }
    },

    humanApproval: async (node: WorkflowNodeDef, run: WorkflowRun) => {
      const { decisionService, auditLogRepo } = getServerContext();
      const d = node.data ?? {};
      const decisionId = `dec_${Date.now()}`;

      decisionService.create({
        id: decisionId,
        projectId: 'default',
        type: 'action',
        title: `Workflow: ${(d.label as string) ?? node.id}`,
        description: `Workflow needs your approval at: ${(d.label as string) ?? node.id}.`,
        options: [
          {
            id: 'approve_continue',
            label: 'Approve & Continue',
            impact: 'Workflow proceeds to next step.',
          },
          { id: 'reject_terminate', label: 'Terminate', impact: 'Workflow stops immediately.' },
        ],
        classification: {
          scopeDescription: 'Workflow human approval',
          isCrossSession: true,
          optionCount: 2,
          estimatedCost: 0,
          involvesFunds: false,
          involvesPermissions: false,
          involvesDataDeletion: false,
          involvesOrgConfig: false,
        },
      });

      auditLogRepo.insert('workflow_approval', decisionId, 'pending', 'system', {
        workflowId: run.workflowId,
        nodeId: node.id,
      });

      broadcast('decision_created', {
        decisionId,
        title: `Workflow: ${(d.label as string) ?? node.id}`,
        level: 'L1',
      });

      return { decisionId, status: 'pending' as const };
    },

    skill: async (skillId: string, input: unknown) => {
      const { skillRegistry } = getServerContext();
      const skill = skillRegistry.load(skillId);
      if (!skill) return `Skill not found: ${skillId}`;
      const result = await skillRegistry.executeSkill(
        skill,
        (input as Record<string, unknown>) ?? {},
      );
      return result.output;
    },

    dispatchToExternalAgent: async (agentId, task) => {
      const ctx = getServerContext();
      const registry = ctx.agentRegistry;
      const roleDef = registry.get(agentId);
      if (!roleDef?.external) {
        throw new Error(`Agent ${agentId} has no external config`);
      }

      const ext = roleDef.external;
      // Cache adapters keyed by agentId
      const cacheKey = `wf_adapter:${agentId}`;
      let adapter: any = (engine as any)._adapterCache?.get(cacheKey);
      if (!adapter) {
        if (ext.protocol === 'cli') {
          adapter = new CliAdapter(agentId, {
            command: ext.command ?? agentId,
            args: ext.args ?? ['--print'],
            env: ext.env,
            permissionMode: ext.permissionMode as any,
            detectCommand: ext.detectCommand,
            installCommand: ext.installCommand,
            timeoutMs: ext.timeoutMs,
            maxRetries: ext.maxRetries,
          });
        } else {
          adapter = new A2AConnector(agentId, {
            baseUrl: ext.baseUrl ?? `http://localhost:${agentId}`,
            healthCheckUrl: ext.healthCheckUrl,
            authConfig: ext.authConfig as any,
            timeoutMs: ext.timeoutMs,
            maxRetries: ext.maxRetries,
          });
        }
        if (!(engine as any)._adapterCache) (engine as any)._adapterCache = new Map();
        (engine as any)._adapterCache.set(cacheKey, adapter);
      }

      const result = await adapter.dispatchTask({
        task_id: `${task.runId}_${task.nodeId}`,
        session_id: task.runId,
        capability: 'default',
        input: task.input,
        slot: task.slot,
        configuration: {
          max_retries: ext.maxRetries ?? 2,
          timeout_ms: ext.timeoutMs ?? 120_000,
          slot_write_url: `http://localhost:${process.env.PORT ?? 3000}/api/slot/${task.runId}_${task.nodeId}/write`,
        },
      });

      if (result.status === 'awaiting_approval') {
        return { status: 'awaiting_approval', decisionId: result.decision_id };
      }
      if (result.status === 'timed_out' || result.status === 'failed') {
        return { status: 'failed', output: result.error, decisionId: result.decision_id };
      }
      return { status: 'completed', output: result.output };
    },
  });

  return engine;
}
