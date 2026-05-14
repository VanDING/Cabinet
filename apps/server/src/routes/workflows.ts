import { Hono } from 'hono';
import { getServerContext } from '../context.js';

export const workflowsRouter = new Hono();

workflowsRouter.get('/', (c) => {
  const { db } = getServerContext();
  const projectId = c.req.query('projectId') ?? 'proj-1';
  const rows = db.prepare(
    'SELECT * FROM workflows WHERE project_id = ? ORDER BY created_at DESC'
  ).all(projectId) as any[];
  const workflows = rows.map((r: any) => ({
    id: r.id, name: r.name, status: r.status,
    definition: JSON.parse(r.definition ?? '{}'),
    projectId: r.project_id, createdAt: r.created_at,
  }));
  return c.json({ workflows });
});

workflowsRouter.post('/', async (c) => {
  const { db } = getServerContext();
  const body = await c.req.json();
  const id = `wf_${Date.now()}`;
  db.prepare(
    'INSERT INTO workflows (id, project_id, name, definition, status) VALUES (?, ?, ?, ?, ?)'
  ).run(id, body.projectId ?? 'proj-1', body.name ?? 'Untitled', JSON.stringify(body.definition ?? {}), 'draft');
  return c.json({ id, status: 'created' }, 201);
});

workflowsRouter.put('/:id', async (c) => {
  const { db } = getServerContext();
  const id = c.req.param('id');
  const body = await c.req.json();
  db.prepare('UPDATE workflows SET name = ?, definition = ? WHERE id = ?')
    .run(body.name ?? 'Untitled', JSON.stringify(body.definition ?? {}), id);
  return c.json({ id, status: 'updated' });
});

workflowsRouter.post('/:id/run', async (c) => {
  const { db, gateway, metrics, logger } = getServerContext();
  const id = c.req.param('id');
  const runId = `run_${Date.now()}`;
  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as any;

  if (!wf) return c.json({ error: 'Workflow not found' }, 404);

  db.prepare('UPDATE workflows SET status = ? WHERE id = ?').run('running', id);

  if (gateway) {
    try {
      const def = JSON.parse(wf.definition ?? '{}');
      const steps = def.steps ?? ['analyze', 'decide', 'execute'];
      const results: string[] = [];
      for (const step of steps) {
        const response = await gateway.generateText({
          model: 'claude-haiku-4-5',
          messages: [{ role: 'user', content: `Execute workflow step: ${step}. Context: ${wf.name}` }],
          maxTokens: 150,
        });
        results.push(response.content);
        metrics.increment('llm_call', { model: 'claude-haiku-4-5', purpose: 'workflow' });
      }
      db.prepare('UPDATE workflows SET status = ? WHERE id = ?').run('completed', id);
      logger.info('Workflow completed', { id, steps: steps.length });
      return c.json({ runId, workflowId: id, status: 'completed', steps: results });
    } catch (e) {
      db.prepare('UPDATE workflows SET status = ? WHERE id = ?').run('failed', id);
      return c.json({ error: (e as Error).message }, 500);
    }
  }

  db.prepare('UPDATE workflows SET status = ? WHERE id = ?').run('completed', id);
  return c.json({ runId, workflowId: id, status: 'completed', note: 'No LLM available — workflow steps skipped' });
});

workflowsRouter.get('/:id/runs', (c) => {
  return c.json({ runs: [], note: 'Run history coming soon' });
});
