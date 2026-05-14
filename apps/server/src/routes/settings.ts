import { Hono } from 'hono';
import { encryptApiKey, decryptApiKey } from '../crypto.js';

// In-memory key store (in production, use SQLite api_keys table)
const keyStore = new Map<string, { provider: string; encryptedKey: string }>();
const MASTER_PW =
  process.env.CABINET_MASTER_PASSWORD ?? 'dev-master-password-change-me';

export const settingsRouter = new Hono();

settingsRouter.get('/budget', (c) =>
  c.json({ daily: 5, weekly: 25, monthly: 100, currentSpend: 0 }),
);
settingsRouter.put('/budget', async (c) => {
  const body = await c.req.json();
  return c.json({ status: 'updated', ...body });
});

settingsRouter.get('/api-keys', (c) => {
  const keys = [...keyStore.entries()].map(([id, k]) => ({
    id,
    provider: k.provider,
    keyPreview:
      decryptApiKey(k.encryptedKey, MASTER_PW).slice(0, 8) + '...',
    encrypted: k.encryptedKey.slice(0, 20) + '...',
  }));
  return c.json({ keys });
});

settingsRouter.post('/api-keys', async (c) => {
  const body = await c.req.json();
  const id = `key_${Date.now()}`;
  const encryptedKey = encryptApiKey(body.apiKey, MASTER_PW);
  keyStore.set(id, {
    provider: body.provider ?? 'unknown',
    encryptedKey,
  });
  return c.json({ id, status: 'key_added', provider: body.provider });
});

settingsRouter.delete('/api-keys/:id', (c) => {
  const id = c.req.param('id');
  keyStore.delete(id);
  return c.json({ status: 'deleted' });
});
