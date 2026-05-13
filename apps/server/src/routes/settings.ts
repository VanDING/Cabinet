import { Hono } from 'hono';
export const settingsRouter = new Hono();

settingsRouter.get('/budget', (c) => c.json({ daily: 5, weekly: 25, monthly: 100, currentSpend: 0 }));
settingsRouter.put('/budget', async (c) => c.json({ status: 'updated' }));
settingsRouter.get('/api-keys', (c) => c.json({ keys: [] }));
settingsRouter.post('/api-keys', async (c) => c.json({ status: 'key_added' }));
settingsRouter.delete('/api-keys/:id', (c) => c.json({ status: 'deleted' }));
