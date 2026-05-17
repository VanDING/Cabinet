import { useState, useEffect } from 'react';
import { apiFetch, authHeaders } from '../utils/pin.js';

export const PROVIDER_MODELS: Record<string, string[]> = {
  anthropic: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-7'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  google: ['gemini-2.0-flash', 'gemini-2.0-pro'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v3', 'deepseek-r1'],
  qwen: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
  moonshot: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  zhipu: ['glm-4', 'glm-4-flash'],
  baichuan: ['baichuan4', 'baichuan3-turbo'],
  custom: ['custom-model'],
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
    apiFetch('/api/settings/api-keys', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.keys?.length > 0) {
          const providers = [...new Set(d.keys.map((k: any) => k.provider))] as string[];
          const filtered = providers.map((p) => ({
            provider: p,
            models: PROVIDER_MODELS[p] ?? [],
          }));
          setAvailable(filtered);
          localStorage.setItem('cabinet-available-models', JSON.stringify(filtered));
        }
        // If no keys configured, keep showing cached providers (or empty)
      })
      .catch(() => {
        // Keep cached providers on fetch failure
      });
    return () => { cancelled = true; };
  }, []);

  return available;
}
