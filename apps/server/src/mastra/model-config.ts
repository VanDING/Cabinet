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

/** Auto-prepend provider prefix if the model name doesn't already have one. */
function ensureProviderPrefix(modelId: string, provider: string): string {
  if (modelId.includes('/')) return modelId;
  return `${provider}/${modelId}`;
}

export function resolveModel(tier: 'default' | 'reasoning' = 'default'): string {
  try {
    const settings = loadSettings();
    const mapping = settings.modelMapping as Record<string, string> | undefined;
    const provider = detectProviderFromSettings();

    if (mapping) {
      const key = tier === 'reasoning' ? 'deep_reasoning' : tier;
      const modelId = mapping[key] || (tier === 'reasoning' && mapping['reasoning']);

      if (modelId) {
        return provider ? ensureProviderPrefix(modelId, provider) : modelId;
      }
    }

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
