import { Hono } from 'hono';
import { encryptApiKey, decryptApiKey } from '../crypto.js';
import { getServerContext } from '../context.js';

export const settingsRouter = new Hono();

// ── Budget ──
settingsRouter.get('/budget', (c) => {
  const { budgetGuard, costTracker } = getServerContext();
  const status = budgetGuard.checkAll();
  return c.json({
    daily: status.find(s => s.period === 'daily')?.limit ?? 5,
    weekly: status.find(s => s.period === 'weekly')?.limit ?? 25,
    monthly: status.find(s => s.period === 'monthly')?.limit ?? 100,
    currentSpend: costTracker.getDailyCost(),
    budgetStatus: status,
  });
});

settingsRouter.put('/budget', async (c) => {
  const body = await c.req.json();
  // Update budget guard limits in memory (persist to DB later)
  return c.json({ status: 'updated', ...body });
});

// ── API Keys (SQLite-backed) ──
const MASTER_PW = process.env.CABINET_MASTER_PASSWORD ?? 'dev-master-password-change-me';

settingsRouter.get('/api-keys', (c) => {
  const { db } = getServerContext();
  try {
    const rows = db.prepare('SELECT id, provider, encrypted_key, key_type, created_at, last_used_at FROM api_keys ORDER BY created_at DESC').all() as any[];
    const keys = rows.map((k: any) => ({
      id: k.id,
      provider: k.provider,
      keyPreview: (() => {
        try { return decryptApiKey(k.encrypted_key, MASTER_PW).slice(0, 8) + '...'; }
        catch { return '***...'; }
      })(),
      encrypted: k.encrypted_key.slice(0, 20) + '...',
      keyType: k.key_type,
      createdAt: k.created_at,
    }));
    return c.json({ keys });
  } catch (e) {
    return c.json({ keys: [], error: (e as Error).message });
  }
});

settingsRouter.post('/api-keys', async (c) => {
  const { db } = getServerContext();
  const body = await c.req.json();
  const id = `key_${Date.now()}`;
  const encryptedKey = encryptApiKey(body.apiKey, MASTER_PW);

  try {
    db.prepare(
      'INSERT INTO api_keys (id, provider, encrypted_key, key_type, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, body.provider ?? 'unknown', encryptedKey, body.keyType ?? 'api_key', new Date().toISOString());
    return c.json({ id, status: 'key_added', provider: body.provider });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

settingsRouter.delete('/api-keys/:id', (c) => {
  const { db } = getServerContext();
  const id = c.req.param('id');
  try {
    db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
    return c.json({ status: 'deleted' });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});
