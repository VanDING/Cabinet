import { loadSettings } from '../routes/settings/persistence.js';

const DEFAULT_TIERS = {
  reasoning: 'openai/gpt-4o',
  default: 'openai/gpt-4o',
};

export function resolveModel(tier: 'default' | 'reasoning' = 'default'): string {
  try {
    const settings = loadSettings();
    const mapping = settings.modelMapping as Record<string, string> | undefined;
    if (mapping) {
      if (tier === 'reasoning')
        return mapping['deep_reasoning'] ?? mapping['reasoning'] ?? DEFAULT_TIERS[tier];
      return mapping[tier] ?? DEFAULT_TIERS[tier];
    }
  } catch {
    /* settings not available */
  }
  return DEFAULT_TIERS[tier];
}

export function resolveModelForAgent(agentId: string): string {
  const tierMap: Record<string, 'default' | 'reasoning'> = {
    planner: 'reasoning',
  };
  return resolveModel(tierMap[agentId] ?? 'default');
}
