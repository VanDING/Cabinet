import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import { broadcast } from '../ws/handler.js';

const factoryRouter = new Hono();

factoryRouter.get('/', (c) => {
  const { workflowRepo } = getServerContext();
  const projectId = c.req.query('projectId');
  const workflows = projectId ? workflowRepo.listByProject(projectId) : workflowRepo.listAll();
  return c.json({ workflows });
});

factoryRouter.post('/', async (c) => {
  const { workflowRepo, logger } = getServerContext();
  const body = await c.req.json().catch(() => ({}));
  const id = body.id ?? `wf_${Date.now()}`;
  const definition =
    typeof body.definition === 'string' ? body.definition : JSON.stringify(body.definition ?? {});
  workflowRepo.create(
    id,
    body.projectId ?? 'default',
    body.name ?? 'Untitled Workflow',
    definition,
    'draft',
  );
  logger.info('Workflow created', { id, name: body.name });
  return c.json({ id, name: body.name, status: 'draft' }, 201);
});

factoryRouter.get('/:id', (c) => {
  const { workflowRepo } = getServerContext();
  const id = c.req.param('id');
  const wf = workflowRepo.findById(id);
  if (!wf) return c.json({ error: 'Workflow not found' }, 404);
  return c.json(wf);
});

factoryRouter.put('/:id', async (c) => {
  const { workflowRepo, logger } = getServerContext();
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const existing = workflowRepo.findById(id);
  if (!existing) return c.json({ error: 'Workflow not found' }, 404);

  workflowRepo.updateNameAndDefinition(
    id,
    body.name ?? existing.name,
    body.definition !== undefined
      ? typeof body.definition === 'string'
        ? body.definition
        : JSON.stringify(body.definition)
      : existing.definition,
  );
  logger.info('Workflow updated', { id });
  return c.json(workflowRepo.findById(id));
});

factoryRouter.delete('/:id', (c) => {
  const { workflowRepo, logger } = getServerContext();
  const id = c.req.param('id');
  const existing = workflowRepo.findById(id);
  if (!existing) return c.json({ error: 'Workflow not found' }, 404);
  workflowRepo.delete(id);
  logger.info('Workflow deleted', { id });
  return c.json({ status: 'deleted' });
});

factoryRouter.get('/:id/runs', (c) => {
  const { workflowRepo } = getServerContext();
  const id = c.req.param('id');
  const runs = workflowRepo.findRunsByWorkflow(id);
  return c.json({ runs });
});

factoryRouter.post('/:id/run', async (c) => {
  const { workflowRepo, mastra, logger } = getServerContext();
  const id = c.req.param('id');
  const wf = workflowRepo.findById(id);
  if (!wf) return c.json({ error: 'Workflow not found' }, 404);

  if (!mastra) return c.json({ error: 'Mastra not initialized' }, 503);

  const mastraWorkflow = mastra.getWorkflow(wf.name);
  if (!mastraWorkflow) return c.json({ error: 'Workflow not available in Mastra' }, 503);

  try {
    const result = await mastraWorkflow.execute({ triggerData: {} } as any);
    const runId = (result as any)?.runId ?? id;
    logger.info('Workflow run completed', { id, runId });
    broadcast('workflow_started', { id, runId, name: wf.name });
    broadcast('workflow_completed', { id, runId, name: wf.name });
    return c.json({ runId, status: 'completed' });
  } catch (err) {
    logger.error('Workflow run failed', { id, error: String(err) });
    broadcast('workflow_started', { id, name: wf.name });
    broadcast('workflow_completed', { id, name: wf.name, status: 'failed', error: String(err) });
    return c.json({ error: String(err) }, 500);
  }
});

export { factoryRouter };
