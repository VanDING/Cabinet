import { useState, useEffect } from 'react';
import { apiFetch, authHeaders } from '../utils/pin.js';

export const PROVIDER_MODELS: Record<string, string[]> = {
  anthropic: ['anthropic/claude-haiku-4-5', 'anthropic/claude-sonnet-4-6', 'anthropic/claude-opus-4-7'],
  openai: ['openai/gpt-4o', 'openai/gpt-4o-mini', 'openai/gpt-4-turbo'],
  google: ['google/gemini-2.0-flash', 'google/gemini-2.0-pro'],
  deepseek: ['deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-pro', 'deepseek/deepseek-chat', 'deepseek/deepseek-reasoner', 'deepseek/deepseek-v3', 'deepseek/deepseek-r1'],
  qwen: ['qwen/qwen-turbo', 'qwen/qwen-plus', 'qwen/qwen-max'],
  moonshot: ['moonshot/moonshot-v1-8k', 'moonshot/moonshot-v1-32k', 'moonshot/moonshot-v1-128k'],
  zhipu: ['zhipu/glm-4', 'zhipu/glm-4-flash'],
  baichuan: ['baichuan/baichuan4', 'baichuan/baichuan3-turbo'],
  custom: ['custom/custom-model'],
};

function loadCachedProviders(): { provider: string; models: string[] }[] | null {
  try {
    const raw = localStorage.getItem('cabinet-available-models');
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

export function useAvailableModels(): { provider: string; models: string[] }[] {
  const [available, setAvailable] = useState<{ provider: string; models: string[] }[]>(
    () => loadCachedProviders() ?? [],
  );

  useEffect(() => {
    let cancelled = false;
    function refresh() {
      apiFetch('/api/settings/api-keys', { headers: authHeaders() })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (d.keys?.length > 0) {
            // Use configured model from API key, fall back to hardcoded list
            const providerModels = new Map<string, Set<string>>();
            for (const k of d.keys) {
              if (!providerModels.has(k.provider)) providerModels.set(k.provider, new Set());
              if (k.model) providerModels.get(k.provider)!.add(`${k.provider}/${k.model}`);
            }
            const filtered = [...providerModels.entries()].map(([provider, models]) => ({
              provider,
              models: models.size > 0 ? [...models] : (PROVIDER_MODELS[provider] ?? []),
            }));
            setAvailable(filtered);
            localStorage.setItem('cabinet-available-models', JSON.stringify(filtered));
          } else {
            // Clear stale cache when all keys are removed
            setAvailable([]);
            localStorage.removeItem('cabinet-available-models');
          }
        })
        .catch(() => {
          // Keep cached providers on fetch failure
        });
    }
    refresh();
    window.addEventListener('apikeys_changed', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('apikeys_changed', refresh);
    };
  }, []);

  return available;
}
