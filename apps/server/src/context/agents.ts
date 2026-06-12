import { AgentRoleRegistry } from '@cabinet/agent';
import type { ModelTier } from '@cabinet/gateway';
import type { BuildState } from './build-state.js';

export function initAgentRegistry(state: BuildState): void {
  const { agentRoleRepo } = state;
  if (!agentRoleRepo) {
    throw new Error('Missing required state for agent registry');
  }

  const agentRegistry = new AgentRoleRegistry();
  try {
    const customRows = agentRoleRepo.findCustom();
    for (const row of customRows) {
      const agentType =
        row.type === 'external_cli' || row.type === 'external_a2a' || row.type === 'custom'
          ? (row.type as 'custom' | 'external_cli' | 'external_a2a')
          : ('custom' as const);
      agentRegistry.register({
        type: agentType,
        name: row.name,
        description: row.description,
        modules: { identity: row.system_prompt },
        modelTier: ((row.model_tier as string) || 'default') as ModelTier,
        temperature: row.temperature,
        maxResponseTokens: row.max_response_tokens,
        allowedTools: JSON.parse(row.allowed_tools ?? '[]'),
        contextBudget: row.context_budget,
      });
    }
    state.logger?.info('Custom agents loaded from DB', { count: customRows.length });
  } catch (e) {
    state.logger?.warn('Failed to load custom agents from DB', { error: String(e) });
  }

  state.agentRegistry = agentRegistry;
}
