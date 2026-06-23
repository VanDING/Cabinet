import { loadSettings } from '../routes/settings/persistence.js';

const DEFAULT_TIERS = {
  reasoning: 'openai/gpt-4o',
  default: 'openai/gpt-4o',
};

export function resolveModel(tier: 'default' | 'reasoning' = 'default'): string {
  try {
    const settings = loadSettings();
    const mapping = settings.modelMapping as Record<string, string> | undefined;
    if (mapping?.[tier]) return mapping[tier]!;
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
