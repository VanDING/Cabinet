import { loadSettings } from '../routes/settings/persistence.js';

type ModelTier = 'default' | 'reasoning';

const DEFAULT_MODELS: Record<string, string> = {
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

const TIER_FALLBACKS: Record<ModelTier, string[]> = {
  default: ['openai/gpt-4o', 'anthropic/claude-sonnet-4-6', 'deepseek/deepseek-chat'],
  reasoning: ['openai/gpt-4o', 'anthropic/claude-sonnet-4-6', 'deepseek/deepseek-chat'],
};

function detectAvailableProviders(): string[] {
  const all = [
    'openai',
    'anthropic',
    'deepseek',
    'google',
    'qwen',
    'moonshot',
    'zhipu',
    'baichuan',
    'openrouter',
  ];
  return all.filter((p) => process.env[`${p.toUpperCase()}_API_KEY`]);
}

function defaultModelForProvider(provider: string): string {
  return DEFAULT_MODELS[provider] ?? 'openai/gpt-4o';
}

export interface ModelFallbackEntry {
  model: string;
  maxRetries: number;
}

export function buildModelConfig(tier: ModelTier = 'default'): ModelFallbackEntry[] {
  const settings = loadSettings();
  const mapping = settings.modelMapping as Record<string, string> | undefined;
  const providers = detectAvailableProviders();
  const chain: ModelFallbackEntry[] = [];

  if (providers.length === 0) {
    chain.push({ model: 'openai/gpt-4o', maxRetries: 0 });
    return chain;
  }

  if (mapping) {
    const key = tier === 'reasoning' ? 'deep_reasoning' : tier;
    const userModel = mapping[key] || mapping['deep_reasoning'] || mapping['reasoning'];
    if (userModel) {
      const withPrefix = userModel.includes('/') ? userModel : `${providers[0]}/${userModel}`;
      chain.push({ model: withPrefix, maxRetries: 2 });
    }
  }

  const configuredModels = new Set(chain.map((c) => c.model));
  for (const provider of providers) {
    const m = defaultModelForProvider(provider);
    if (!configuredModels.has(m)) {
      chain.push({ model: m, maxRetries: 2 });
      configuredModels.add(m);
    }
  }

  if (chain.length === 0) {
    const fallbacks = TIER_FALLBACKS[tier];
    for (const fb of fallbacks) {
      chain.push({ model: fb, maxRetries: 0 });
    }
  }

  return chain;
}

export function getAvailableModelNames(): string[] {
  const providers = detectAvailableProviders();
  return providers.map(defaultModelForProvider);
}
