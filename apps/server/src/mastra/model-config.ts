import { loadSettings } from '../routes/settings/persistence.js';

const DEFAULT_TIERS = {
  reasoning: 'openai/gpt-4o',
  default: 'openai/gpt-4o',
};

function detectProviderFromSettings(): string | null {
  try {
    const settings = loadSettings();
    const providers = settings.providers as Record<string, unknown> | undefined;
    const provider = providers ? Object.keys(providers)[0] : null;
    return provider?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function defaultModelForProvider(provider: string): string {
  const models: Record<string, string> = {
    deepseek: 'deepseek/deepseek-chat',
    openai: 'openai/gpt-4o',
    anthropic: 'anthropic/claude-sonnet-4-6',
    google: 'google/gemini-2.0-flash',
  };
  return models[provider] ?? `openai/gpt-4o`;
}

export function resolveModel(tier: 'default' | 'reasoning' = 'default'): string {
  try {
    const settings = loadSettings();
    const mapping = settings.modelMapping as Record<string, string> | undefined;
    if (mapping) {
      const key = tier === 'reasoning' ? 'deep_reasoning' : tier;
      if (mapping[key]) return mapping[key]!;
      if (tier === 'reasoning' && mapping['reasoning']) return mapping['reasoning']!;
    }
    // Auto-detect from user's configured API keys
    const provider = detectProviderFromSettings();
    if (provider) return defaultModelForProvider(provider);
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
