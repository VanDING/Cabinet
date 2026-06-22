import { getServerContext } from '../../context.js';
import { broadcast } from '../../ws/handler.js';
import {
  WorkflowEngine,
  type WorkflowNodeDef,
  type WorkflowRun,
  type AgentLoopHandle,
} from '@cabinet/workflow';
import { SdkAgentLoopAdapter, CliAdapter, A2AConnector } from '@cabinet/agent';
import { buildEnvironmentSection } from '../../capabilities.js';
import {
  toolExecutorCache,
  agentLoopPool,
  AGENT_LOOP_POOL_MAX,
  pendingCapabilities,
} from './state.js';
import { buildToolDependencies } from './tool-deps.js';

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

      const toolDeps = buildToolDependencies(pendingCapabilities);
      const instructions = buildEnvironmentSection() + '\n\n' + role.modules.identity;
      const model = (ctx.gateway as any).resolveModelString?.(role.modelTier) ?? role.modelTier;

      const adapter = new SdkAgentLoopAdapter(toolDeps, {
        instructions,
        model,
        temperature: role.temperature,
        maxResponseTokens: role.maxResponseTokens,
        maxSteps: options.persistent !== false ? 20 : 50,
        allowedTools: role.allowedTools,
      });

      // Add to pool with LRU eviction (cache by config)
      if (options.persistent !== false) {
        if (agentLoopPool.size >= AGENT_LOOP_POOL_MAX) {
          const firstKey = agentLoopPool.keys().next().value;
          if (firstKey) agentLoopPool.delete(firstKey);
        }
        agentLoopPool.set(cacheKey, adapter);
      }

      return {
        async run(message: string) {
          const result = await adapter.run(message);
          ctx.metrics.increment('llm_call', {
            model,
            purpose: 'workflow_segment',
          });
          return result.content;
        },
        async dispose() {
          if (options.persistent === false) {
            agentLoopPool.delete(cacheKey);
          }
        },
        async handoff() {
          return ''; // handoff replaced by subagent context passing
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

    tool: async (toolId: string, _params: Record<string, unknown>) => {
      const { agentRegistry } = getServerContext();
      return `Tool ${toolId} executed (stub)`;
    },

    runSubWorkflow: async (workflowId: string, _input: unknown) => {
      try {
        const { runWorkflowById } = await import('./routes.js');
        const result = await runWorkflowById(workflowId);
        return `Sub-workflow completed: ${result.runId}`;
      } catch (e: any) {
        return `Sub-workflow failed: ${e.message}`;
      }
    },

    knowledgeBase: async (node: WorkflowNodeDef, _input: unknown) => {
      const d = node.data ?? {};
      const query =
        (d.query as string) ?? (d.prompt as string) ?? (typeof _input === 'string' ? _input : '');
      try {
        const ctx = getServerContext();
        const results = await ctx.longTerm.search(query, 5);
        return results.map((r: any) => ({ content: r.content, score: r.score ?? 0 }));
      } catch {
        return [{ content: 'Knowledge base search failed', score: 0 }];
      }
    },

    humanTask: async (node: WorkflowNodeDef, run: WorkflowRun) => {
      const d = node.data ?? {};
      const { decisionService, auditLogRepo } = getServerContext();
      const decisionId = `dec_${Date.now()}`;
      decisionService.create({
        id: decisionId,
        projectId: 'default',
        type: 'action',
        title: `Human Task: ${(d.label as string) ?? node.id}`,
        description: (d.description as string) ?? `Please complete the task at: ${node.id}`,
        options: [
          { id: 'complete', label: 'Complete', impact: 'Task done.' },
          { id: 'skip', label: 'Skip', impact: 'Skip this task.' },
        ],
        classification: {
          scopeDescription: 'Workflow human task',
          isCrossSession: true,
          optionCount: 2,
          estimatedCost: 0,
          involvesFunds: false,
          involvesPermissions: false,
          involvesDataDeletion: false,
          involvesOrgConfig: false,
        },
      });
      auditLogRepo.insert('workflow_humantask', decisionId, 'pending', 'system', {
        workflowId: run.workflowId,
        nodeId: node.id,
      });
      broadcast('decision_created', {
        decisionId,
        title: `Human Task: ${(d.label as string) ?? node.id}`,
        level: 'L1',
      });
      return { taskId: decisionId, status: 'submitted' as const };
    },
  });

  return engine;
}
