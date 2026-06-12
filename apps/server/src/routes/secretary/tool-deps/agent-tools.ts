/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ServerContext } from '../../../context.js';
import { DEFAULT_CAPTAIN_ID } from '@cabinet/types';
import { CABINET_DIR } from '@cabinet/storage';
import type { AgentRoleType } from '@cabinet/agent';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function buildAgentTools(
  ctx: ServerContext,
  _activeProjectId: string | undefined,
  _inject: Record<string, unknown> | undefined,
) {
  return {
    registerAgent(input: any) {
      const role = {
        type: 'custom' as const,
        name: input.name,
        description: input.description,
        modules: { identity: input.systemPrompt },
        modelTier: ((input as any).modelTier as string) || 'default',
        temperature: input.temperature,
        maxResponseTokens: input.maxResponseTokens,
        allowedTools: input.allowedTools,
        contextBudget: input.contextBudget,
      };
      ctx.agentRegistry.register(role as any);
      // Persist to DB
      try {
        ctx.agentRoleRepo.upsert({
          type: input.name,
          name: input.name,
          description: input.description ?? '',
          system_prompt: input.systemPrompt ?? '',
          model_tier: ((input as any).modelTier as string) || 'default',
          temperature: input.temperature ?? 0.3,
          max_response_tokens: input.maxResponseTokens ?? 4000,
          allowed_tools: JSON.stringify(input.allowedTools ?? []),
          context_budget: input.contextBudget ?? 0.4,
          is_builtin: 0,
          created_at: new Date().toISOString(),
        });
      } catch (e) {
        ctx.logger.warn('Failed to persist custom agent to DB', {
          name: input.name,
          error: String(e),
        });
      }
      // Persist to disk (~/.cabinet/agents/<name>/agent.json)
      try {
        const agentsDir = join(CABINET_DIR, 'agents', input.name);
        if (!existsSync(agentsDir)) mkdirSync(agentsDir, { recursive: true });
        writeFileSync(join(agentsDir, 'agent.json'), JSON.stringify(role, null, 2), 'utf-8');
      } catch (e) {
        ctx.logger.warn('Failed to persist custom agent to disk', {
          name: input.name,
          error: String(e),
        });
      }
      ctx.logger.info('Agent registered via tool', { name: input.name });
      return { type: 'custom', name: input.name };
    },
    updateAgent(name: string, updates: any) {
      const existing = ctx.agentRegistry.get(name);
      if (existing && existing.type === 'custom') {
        ctx.agentRegistry.update(name, updates as any);
        // Update DB
        ctx.agentRoleRepo.update(name, {
          system_prompt: updates.systemPrompt as string,
          model: updates.model as string,
          model_tier: updates.modelTier as string,
          temperature: updates.temperature as number,
          max_response_tokens: updates.maxResponseTokens as number,
          allowed_tools: updates.allowedTools ? JSON.stringify(updates.allowedTools) : undefined,
          context_budget: updates.contextBudget as number,
        });
      }
    },
    deleteAgent(name: string) {
      ctx.agentRegistry.unregister(name);
      ctx.agentRoleRepo.deleteByName(name);
    },
    listAgents() {
      return ctx.agentRegistry.list().map((r) => ({
        type: r.type,
        name: r.name,
        description: r.description,
        builtIn: r.type !== 'custom',
      }));
    },
    async invokeAgent(agentName: string, message: string, callerSessionId?: string) {
      const registry = ctx.agentRegistry;
      const role = registry.get(agentName);
      if (!role) throw new Error(`Agent not found: ${agentName}`);

      const loop = (_inject?.getAgentLoopForRole as any)?.(
        role.type as AgentRoleType,
        `${callerSessionId ?? 'invoke'}_${Date.now()}`,
        'global',
        DEFAULT_CAPTAIN_ID,
        undefined,
        (_inject?.resolveModel as (arg: { modelTier: string }) => string)?.({
          modelTier: 'default',
        }),
        callerSessionId,
      );
      if (!loop) throw new Error(`Cannot invoke ${agentName}: no LLM gateway available`);
      // Inject recent conversation context from caller session
      let augmentedMessage = message;
      if (callerSessionId) {
        const session = ctx.sessionManager.get(callerSessionId);
        if (session && session.messages.length > 0) {
          const recent = session.messages.slice(-10);
          const history = recent.map((m) => `[${m.role}]: ${m.content.slice(0, 500)}`).join('\n');
          augmentedMessage = `[Conversation history — use for context only. The current task follows after "---"]:\n${history}\n\n---\n\n[Current task]: ${message}`;
        }
      }
      const result = await loop.run(augmentedMessage);
      return { agentName: role.name, response: result.content };
    },
  };
}
