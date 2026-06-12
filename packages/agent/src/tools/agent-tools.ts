import type { ToolDefinition } from '../tool-executor.js';
import type { ToolDependencies } from './tool-dependencies.js';

export function createAgentTools(deps: ToolDependencies): ToolDefinition[] {
  return [
    // ═══════════════════════════════════════════════════════════
    // Agent Management Tools
    // ═══════════════════════════════════════════════════════════
    {
      name: 'list_agents',
      parameters: { type: 'object', properties: {} },
      execute: async (_args: Record<string, unknown>) => {
        return deps.listAgents();
      },
    },
    {
      name: 'register_agent',
      parameters: { type: 'object', properties: {} },
      execute: async (args: Record<string, unknown>) => {
        const name = args.name as string;
        const description = (args.description as string) ?? '';
        const systemPrompt = (args.systemPrompt as string) ?? '';
        const modelTier = (args.modelTier as string) || 'default';
        const temperature = (args.temperature as number) ?? 0.3;
        const maxResponseTokens = (args.maxResponseTokens as number) ?? 4000;
        const rawAllowedTools = args.allowedTools;
        if (rawAllowedTools !== undefined && !Array.isArray(rawAllowedTools)) {
          return {
            error:
              'allowedTools must be an array of strings, e.g., ["read_file", "write_file"]. Got: ' +
              typeof rawAllowedTools,
          };
        }
        const allowedTools = (rawAllowedTools as string[]) ?? [];
        for (let i = 0; i < allowedTools.length; i++) {
          if (typeof allowedTools[i] !== 'string') {
            return { error: `allowedTools[${i}] must be a string. Got: ${typeof allowedTools[i]}` };
          }
        }
        const contextBudget = (args.contextBudget as number) ?? 0.3;

        if (!name) return { error: 'name is required' };
        if (!/^[\w一-鿿\s-]{2,64}$/.test(name)) {
          return {
            error:
              'Invalid agent name. Use 2-64 characters: letters, digits, Chinese, underscores, hyphens, spaces.',
          };
        }
        if (!systemPrompt) return { error: 'systemPrompt is required' };

        return deps.registerAgent({
          name,
          description,
          systemPrompt,
          modelTier,
          temperature,
          maxResponseTokens,
          allowedTools,
          contextBudget,
        });
      },
    },
    {
      name: 'update_agent',
      parameters: { type: 'object', properties: {} },
      execute: async (args: Record<string, unknown>) => {
        const name = args.name as string;
        if (!name) return { error: 'name is required' };
        const updates: Record<string, unknown> = {};
        if (args.description !== undefined) updates.description = args.description;
        if (args.systemPrompt !== undefined) updates.systemPrompt = args.systemPrompt;
        if (args.modelTier !== undefined) updates.modelTier = args.modelTier;
        if (args.temperature !== undefined) updates.temperature = args.temperature;
        if (args.maxResponseTokens !== undefined)
          updates.maxResponseTokens = args.maxResponseTokens;
        if (args.allowedTools !== undefined) updates.allowedTools = args.allowedTools;
        if (args.contextBudget !== undefined) updates.contextBudget = args.contextBudget;
        deps.updateAgent(name, updates);
        return { updated: true, name };
      },
    },
    {
      name: 'delete_agent',
      parameters: { type: 'object', properties: {} },
      execute: async (args: Record<string, unknown>) => {
        const name = args.name as string;
        if (!name) return { error: 'name is required' };
        deps.deleteAgent(name);
        return { deleted: true, name };
      },
    },
    {
      name: 'invoke_agent',
      parameters: { type: 'object', properties: {} },
      execute: async (args: Record<string, unknown>, context) => {
        const agentName = args.agentName as string;
        const message = args.message as string;
        if (!agentName) return { error: 'agentName is required' };
        if (!message) return { error: 'message is required' };
        return deps.invokeAgent(agentName, message, context?.sessionId);
      },
    },
  ];
}
