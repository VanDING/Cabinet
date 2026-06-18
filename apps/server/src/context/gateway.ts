import type { LLMGateway, ModelMapping, ProviderEntry } from '@cabinet/gateway';
import { AISDKAdapter, CostTracker, BudgetGuard } from '@cabinet/gateway';
import type { LlmJudge } from '@cabinet/memory';
import { decryptApiKey } from '../crypto.js';
import { config } from '../config.js';
import { activeApiKeyId, setActiveApiKeyId } from './api-keys.js';
import { createLlmJudge } from '../llm-judge.js';
import type { BuildState } from './build-state.js';

const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  anthropic: 'anthropic/claude-haiku-4-5',
  openai: 'openai/gpt-4o-mini',
  google: 'google/gemini-2.5-flash',
  deepseek: 'deepseek/deepseek-v4-flash',
  qwen: 'qwen/qwen-turbo',
  moonshot: 'moonshot/moonshot-v1-8k',
  zhipu: 'zhipu/glm-4-flash',
  baichuan: 'baichuan/baichuan3-turbo',
};

const PROVIDER_PREFERENCE = [
  'anthropic',
  'openai',
  'google',
  'deepseek',
  'qwen',
  'moonshot',
  'zhipu',
  'baichuan',
];

const FALLBACK_MODEL = PROVIDER_DEFAULT_MODEL.anthropic;

function buildDefaultModelMapping(providers: Record<string, unknown>): ModelMapping {
  const primary = PROVIDER_PREFERENCE.find((p) => providers[p] != null);
  if (!primary) return { default: FALLBACK_MODEL };
  return { default: PROVIDER_DEFAULT_MODEL[primary] ?? FALLBACK_MODEL };
}

export function initGateway(state: BuildState): void {
  const { costHistoryRepo, settingsRepo } = state;
  if (!state.apiKeyRepo || !costHistoryRepo || !settingsRepo) {
    throw new Error('Missing required state for gateway');
  }

  costHistoryRepo.ensureTable();
  const costTracker = new CostTracker({
    persist: (entry) => {
      costHistoryRepo.insert(
        entry.model,
        entry.promptTokens,
        entry.completionTokens,
        entry.costRmb,
      );
    },
  });
  try {
    const recentRows = costHistoryRepo.findSince(31);
    if (recentRows.length > 0) {
      costTracker.restore(
        recentRows.map((r) => ({
          timestamp: new Date(r.timestamp),
          model: r.model,
          promptTokens: r.prompt_tokens,
          completionTokens: r.completion_tokens,
          cachedPromptTokens: 0,
          costRmb: r.cost_usd,
        })),
      );
      state.logger?.info('Cost history restored', { entries: recentRows.length });
    }
  } catch (e) {
    state.logger?.warn('Failed to restore cost history', { error: String(e) });
  }
  const budgetGuard = new BudgetGuard(costTracker);

  let modelMapping: ModelMapping = {};
  let providerConfigsFromSettings: Record<string, ProviderEntry> = {};

  function buildGateway(): LLMGateway | null {
    const providerConfigs: Record<string, { apiKey: string; baseUrl?: string }> = {};

    if (config.anthropicApiKey) providerConfigs.anthropic = { apiKey: config.anthropicApiKey };
    if (config.openaiApiKey) providerConfigs.openai = { apiKey: config.openaiApiKey };
    if (config.deepseekApiKey) providerConfigs.deepseek = { apiKey: config.deepseekApiKey };
    if (config.qwenApiKey) providerConfigs.qwen = { apiKey: config.qwenApiKey };
    if (config.moonshotApiKey) providerConfigs.moonshot = { apiKey: config.moonshotApiKey };
    if (config.zhipuApiKey) providerConfigs.zhipu = { apiKey: config.zhipuApiKey };
    if (config.baichuanApiKey) providerConfigs.baichuan = { apiKey: config.baichuanApiKey };

    const mpw = config.masterPassword;
    try {
      const apiKeys = state.apiKeyRepo!.findAll();
      for (const row of apiKeys) {
        try {
          const decrypted = decryptApiKey(row.encrypted_key, mpw);
          providerConfigs[row.provider] = { apiKey: decrypted, baseUrl: row.base_url ?? undefined };
        } catch {
          /* skip corrupted key row */
        }
      }
    } catch {
      /* API keys table not available */
    }

    for (const [name, entry] of Object.entries(providerConfigsFromSettings)) {
      if (entry?.apiKey) {
        providerConfigs[name] = { apiKey: entry.apiKey, baseUrl: entry.baseUrl };
      }
    }

    if (activeApiKeyId) {
      try {
        const pref = state.apiKeyRepo!.findById(activeApiKeyId);
        if (pref) {
          const decrypted = decryptApiKey(pref.encrypted_key, mpw);
          providerConfigs[pref.provider] = {
            apiKey: decrypted,
            baseUrl: pref.base_url ?? undefined,
          };
        }
      } catch (err) {
        state.logger?.warn('Failed to decrypt preferred API key, clearing active key', {
          error: (err as Error).message,
        });
        setActiveApiKeyId(null);
      }
    }

    if (Object.keys(providerConfigs).length > 0) {
      const effectiveMapping =
        Object.keys(modelMapping).length > 0
          ? modelMapping
          : buildDefaultModelMapping(providerConfigs);
      return new AISDKAdapter(providerConfigs as any, effectiveMapping);
    }
    return null;
  }

  let gateway: LLMGateway | null = buildGateway();
  let llmJudge: LlmJudge | undefined;

  if (gateway) {
    state.logger?.info('LLM Gateway initialized');
    llmJudge = createLlmJudge({ gateway });
  } else {
    state.logger?.warn('No API keys configured — add keys in Settings, then refresh');
  }

  const refreshGateway = () => {
    const gw = buildGateway();
    if (gw) {
      gateway = gw;
      state.gateway = gw;
      llmJudge = createLlmJudge({ gateway: gw });
      state.llmJudge = llmJudge;
      state.logger?.info('LLM Gateway refreshed');
    }
  };

  state.gateway = gateway;
  state.refreshGateway = refreshGateway;
  state.costTracker = costTracker;
  state.budgetGuard = budgetGuard;
  state.llmJudge = llmJudge;
  state.modelMapping = modelMapping;
  state.providerConfigsFromSettings = providerConfigsFromSettings;

  // Allow settings loader to mutate these
  (state as any).setModelMapping = (m: ModelMapping) => {
    modelMapping = m;
  };
  (state as any).setProviderConfigsFromSettings = (p: Record<string, ProviderEntry>) => {
    providerConfigsFromSettings = p;
  };
}
