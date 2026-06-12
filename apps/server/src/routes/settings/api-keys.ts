/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Hono } from 'hono';
import { getServerContext } from '../../context.js';
import { encryptApiKey, decryptApiKey } from '../../crypto.js';
import { broadcast } from '../../ws/handler.js';
import { AISDKAdapter } from '@cabinet/gateway';
import { MASTER_PW } from './persistence.js';

function ensureApiKeyColumns(db: any) {
  try {
    db.prepare("ALTER TABLE api_keys ADD COLUMN base_url TEXT DEFAULT ''").run();
  } catch {
    /* column already exists */
  }
  try {
    db.prepare("ALTER TABLE api_keys ADD COLUMN model TEXT DEFAULT ''").run();
  } catch {
    /* column already exists */
  }
}

export function registerApiKeyRoutes(router: Hono): void {
  router.get('/api-keys', (c) => {
    const { apiKeyRepo } = getServerContext();
    try {
      const rows = apiKeyRepo.findAll();
      const keys = rows.map((k) => ({
        id: k.id,
        provider: k.provider,
        keyPreview: (() => {
          try {
            return decryptApiKey(k.encrypted_key, MASTER_PW).slice(0, 8) + '...';
          } catch {
            return '***...';
          }
        })(),
        encrypted: k.encrypted_key.slice(0, 20) + '...',
        keyType: k.key_type,
        createdAt: k.created_at,
        baseUrl: k.base_url ?? '',
        model: k.model ?? '',
      }));
      return c.json({ keys });
    } catch (e) {
      return c.json({ keys: [], error: (e as Error).message });
    }
  });

  router.post('/api-keys', async (c) => {
    const { apiKeyRepo, refreshGateway } = getServerContext();
    const body = await c.req.json();
    const id = `key_${Date.now()}`;
    const encryptedKey = encryptApiKey(body.apiKey, MASTER_PW);

    try {
      apiKeyRepo.insert({
        id,
        provider: body.provider ?? 'unknown',
        encrypted_key: encryptedKey,
        key_type: body.keyType ?? 'api_key',
        created_at: new Date().toISOString(),
        last_used_at: null,
        base_url: body.baseUrl ?? '',
        model: body.model ?? '',
      });
      refreshGateway();
      broadcast('apikeys_changed', {
        action: 'added',
        provider: body.provider,
        timestamp: new Date().toISOString(),
      });
      return c.json({ id, status: 'key_added', provider: body.provider });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500);
    }
  });

  router.delete('/api-keys/:id', (c) => {
    const { apiKeyRepo, refreshGateway } = getServerContext();
    const id = c.req.param('id');
    try {
      apiKeyRepo.delete(id);
      refreshGateway();
      broadcast('apikeys_changed', { action: 'deleted', id, timestamp: new Date().toISOString() });
      return c.json({ status: 'deleted' });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500);
    }
  });

  router.post('/preferred-key', async (c) => {
    const { apiKeyRepo, refreshGateway } = getServerContext();
    const { setActiveApiKeyId } = await import('../../context.js');
    const { keyId } = await c.req.json<{ keyId: string | null }>();
    if (keyId) {
      const row = apiKeyRepo.findById(keyId);
      if (!row) return c.json({ error: 'API key not found' }, 404);
    }
    setActiveApiKeyId(keyId);
    refreshGateway();
    return c.json({ status: 'ok', preferredKeyId: keyId });
  });

  router.post('/api-keys/:id/test', async (c) => {
    const { apiKeyRepo } = getServerContext();
    const id = c.req.param('id');
    const row = apiKeyRepo.findById(id);
    if (!row) {
      return c.json({ status: 'error', message: 'API key not found' }, 404);
    }

    let decryptedKey: string;
    try {
      decryptedKey = decryptApiKey(row.encrypted_key, MASTER_PW);
    } catch {
      return c.json({ status: 'error', message: 'Failed to decrypt API key' }, 500);
    }

    const provider = row.provider;
    const baseUrl = row.base_url ?? undefined;

    // Build a temporary adapter with only this provider
    const providerConfigs: Record<string, { apiKey: string; baseUrl?: string }> = {
      [provider]: { apiKey: decryptedKey, ...(baseUrl ? { baseUrl } : {}) },
    };

    // Provider-specific fast test models — avoids hardcoded Anthropic fallback in ModelRouter
    const FAST_TEST_MODELS: Record<string, string> = {
      anthropic: 'anthropic/claude-haiku-4-5',
      openai: 'openai/gpt-4o-mini',
      google: 'google/gemini-2.5-flash',
      deepseek: 'deepseek/deepseek-v4-flash',
      qwen: 'qwen/qwen-turbo',
      moonshot: 'moonshot/moonshot-v1-8k',
      zhipu: 'zhipu/glm-4-flash',
      baichuan: 'baichuan/baichuan3-turbo',
    };
    const testModel = FAST_TEST_MODELS[provider] ?? `${provider}/default`;

    const tempAdapter = new AISDKAdapter(providerConfigs as any, {});

    const start = Date.now();
    try {
      const result = await tempAdapter.generateText({
        model: testModel,
        messages: [{ role: 'user', content: 'Reply with just "OK".' }],
        maxTokens: 10,
      });
      const latency = Date.now() - start;
      return c.json({ status: 'ok', latency_ms: latency, model: result.model });
    } catch (e) {
      return c.json({ status: 'error', message: (e as Error).message ?? 'Connection failed' }, 503);
    }
  });
}
