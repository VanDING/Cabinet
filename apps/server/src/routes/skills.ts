import { Hono } from 'hono';
export const skillsRouter = new Hono();

// Stub skills for demo
const demoSkills = [
  { id: 'skill-1', name: 'Market Analysis', description: 'Analyze market conditions for a sector', kind: 'tool', version: 1, status: 'active' },
  { id: 'skill-2', name: 'Financial Review', description: 'Review financial statements and flag anomalies', kind: 'tool', version: 2, status: 'active' },
  { id: 'skill-3', name: 'Competitor Research', description: 'Gather and analyze competitor intelligence', kind: 'prompt', version: 1, status: 'draft' },
];

skillsRouter.get('/', (c) => c.json({ skills: demoSkills }));

skillsRouter.post('/', async (c) => {
  const body = await c.req.json();
  return c.json({ id: `skill_${Date.now()}`, status: 'registered', name: body.name });
});

skillsRouter.put('/:id', async (c) => c.json({ id: c.req.param('id'), status: 'updated' }));

skillsRouter.post('/:id/test', async (c) => {
  const body = await c.req.json();
  const input = body.input as string;
  return c.json({ skillId: c.req.param('id'), output: `Test completed for input: "${input}". Skill executed successfully.` });
});
