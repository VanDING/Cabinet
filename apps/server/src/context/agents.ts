import { AgentRoleRegistry, Scanner } from '@cabinet/agent';
import type { ExternalAgentConfig } from '@cabinet/types';
import type { BuildState } from './types.js';

type ModelTier = 'default' | 'fast_execution' | 'deep_reasoning';

function parseExternalConfig(raw: string | null | undefined): ExternalAgentConfig | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as ExternalAgentConfig;
    if (parsed.protocol !== 'cli' && parsed.protocol !== 'a2a') return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

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
      const isExternal = agentType === 'external_cli' || agentType === 'external_a2a';
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
        external: isExternal ? parseExternalConfig(row.external_config) : undefined,
      });
    }
    state.logger?.info('Custom agents loaded from DB', { count: customRows.length });
  } catch (e) {
    state.logger?.warn('Failed to load custom agents from DB', { error: String(e) });
  }

  const scanner = new Scanner(agentRegistry, agentRoleRepo);
  scanner
    .scanAll()
    .catch((e) => state.logger?.warn('Scanner discovery failed', { error: String(e) }));

  state.agentRegistry = agentRegistry;
}
