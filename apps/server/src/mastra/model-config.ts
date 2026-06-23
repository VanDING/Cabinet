import { loadSettings } from '../routes/settings/persistence.js';

const DEFAULT_TIERS = {
  reasoning: 'openai/gpt-4o',
  default: 'openai/gpt-4o',
};

function detectPrimaryProvider(): string | null {
  const primary = process.env.CABINET_PRIMARY_PROVIDER;
  if (primary) return primary;
  const providers = [
    'deepseek',
    'openai',
    'anthropic',
    'google',
    'qwen',
    'moonshot',
    'zhipu',
    'baichuan',
  ];
  return providers.find((p) => process.env[`${p.toUpperCase()}_API_KEY`]) ?? null;
}

function defaultModelForProvider(provider: string): string {
  const models: Record<string, string> = {
    deepseek: 'deepseek/deepseek-chat',
    openai: 'openai/gpt-4o',
    anthropic: 'anthropic/claude-sonnet-4-6',
    google: 'google/gemini-2.0-flash',
    qwen: 'qwen/qwen-plus',
    moonshot: 'moonshot/moonshot-v1-32k',
    zhipu: 'zhipu/glm-4-flash',
    baichuan: 'baichuan/baichuan4',
    openrouter: 'openrouter/anthropic/claude-sonnet-4',
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
    const provider = detectPrimaryProvider();

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
