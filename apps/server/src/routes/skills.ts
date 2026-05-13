import { Hono } from 'hono';
export const skillsRouter = new Hono();

skillsRouter.get('/', (c) => c.json({ skills: [] }));
skillsRouter.post('/', async (c) => c.json({ id: `skill_${Date.now()}`, status: 'registered' }));
skillsRouter.put('/:id', async (c) => c.json({ id: c.req.param('id'), status: 'updated' }));
skillsRouter.post('/:id/test', async (c) => c.json({ skillId: c.req.param('id'), output: 'test output' }));
