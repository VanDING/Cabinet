import type { Hono } from 'hono';
import crypto from 'node:crypto';
import { getServerContext } from '../../context.js';
import { encryptApiKey, decryptApiKey } from '../../crypto.js';
import { broadcast } from '../../ws/handler.js';
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

const PROVIDER_BASE_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/chat/completions',
  google: 'https://generativelanguage.googleapis.com/v1beta/models',
  deepseek: 'https://api.deepseek.com/v1/chat/completions',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  moonshot: 'https://api.moonshot.cn/v1/chat/completions',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  baichuan: 'https://api.baichuan-ai.com/v1/chat/completions',
};

async function testProviderApiKey(
  provider: string,
  apiKey: string,
  baseUrl?: string,
): Promise<{ ok: boolean; latency_ms: number; model?: string; message?: string }> {
  const url = baseUrl || PROVIDER_BASE_URLS[provider];
  if (!url) return { ok: false, latency_ms: 0, message: `Unknown provider: ${provider}` };

  const start = Date.now();
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (provider === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else if (provider === 'google') {
      headers['x-goog-api-key'] = apiKey;
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const TEST_MODELS: Record<string, string> = {
      anthropic: 'claude-haiku-4-5',
      google: 'gemini-2.0-flash',
      deepseek: 'deepseek-chat',
      openai: 'gpt-4o-mini',
      qwen: 'qwen-turbo',
      moonshot: 'moonshot-v1-8k',
      zhipu: 'glm-4-flash',
      baichuan: 'baichuan3-turbo',
    };
    const body = JSON.stringify({
      model: TEST_MODELS[provider] ?? 'default',
      messages: [{ role: 'user', content: 'OK' }],
      max_tokens: 10,
      maxTokens: 10,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(15000),
    });
    const latency = Date.now() - start;
    if (res.ok) return { ok: true, latency_ms: latency, model: provider };
    const text = await res.text().catch(() => '');
    return { ok: false, latency_ms: latency, message: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, latency_ms: Date.now() - start, message: (e as Error).message };
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
            const decrypted = decryptApiKey(k.encrypted_key, MASTER_PW);
            if (decrypted.length <= 8) return `${decrypted.slice(0, 2)}***${decrypted.slice(-2)}`;
            return `${decrypted.slice(0, 4)}...${decrypted.slice(-4)}`;
          } catch {
            return '***';
          }
        })(),
        baseUrl: k.base_url || '',
        model: k.model || '',
        createdAt: (k as any).created_at ?? '',
      }));
      return c.json({ keys });
    } catch {
      return c.json({ keys: [] });
    }
  });

  router.post('/api-keys', async (c) => {
    const { db, apiKeyRepo } = getServerContext();
    ensureApiKeyColumns(db);
    const { provider, key, baseUrl, model } = await c.req.json<{
      provider: string;
      key: string;
      baseUrl?: string;
      model?: string;
    }>();
    if (!provider || !key) {
      return c.json({ error: 'Provider and key are required' }, 400);
    }
    try {
      const encrypted = encryptApiKey(key, MASTER_PW);
      const id = crypto.randomUUID();
      apiKeyRepo.insert({
        id,
        provider,
        encrypted_key: encrypted,
        key_type: 'api_key',
        created_at: new Date().toISOString(),
        last_used_at: null,
        base_url: baseUrl ?? '',
        model: model ?? '',
      });
      broadcast('settings_changed', { section: 'api_keys' });
      return c.json({ id, status: 'created' }, 201);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500);
    }
  });

  router.delete('/api-keys/:id', (c) => {
    const { apiKeyRepo } = getServerContext();
    const id = c.req.param('id');
    apiKeyRepo.delete(id);
    broadcast('settings_changed', { section: 'api_keys' });
    return c.json({ status: 'deleted' });
  });

  router.post('/preferred-key', async (c) => {
    const { keyId } = await c.req.json<{ keyId: string | null }>();
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

    const result = await testProviderApiKey(row.provider, decryptedKey, row.base_url ?? undefined);
    if (result.ok) {
      return c.json({ status: 'ok', latency_ms: result.latency_ms, model: result.model });
    }
    return c.json({ status: 'error', message: result.message ?? 'Connection failed' }, 503);
  });
}
