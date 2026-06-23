import { Hono } from 'hono';
import { getServerContext } from '../context.js';

// This router is deprecated. Scheduled tasks have been merged into workflows
// (cron_expression column on workflows table). Kept for reference / rollback.
export const scheduledTasksRouter = new Hono();

// GET /api/scheduled-tasks — now lists workflows with cron
scheduledTasksRouter.get('/', (c) => {
  const ctx = getServerContext();
  try {
    const tasks = ctx.taskScheduler.list();
    return c.json({ tasks });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// POST /api/scheduled-tasks — now creates a workflow with cron
scheduledTasksRouter.post('/', async (c) => {
  const ctx = getServerContext();
  try {
    const body = await c.req.json();
    const { name, cron, prompt, recurring } = body as {
      name?: string;
      cron?: string;
      prompt?: string;
      recurring?: boolean;
    };
    if (!name || !cron || !prompt) {
      return c.json({ error: 'name, cron, and prompt are required' }, 400);
    }
    const id = `wf_${Date.now()}`;
    const def = JSON.stringify({
      steps: [{ type: 'llm', title: name, data: { prompt } }],
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'exec', type: 'llm', title: name, data: { prompt } },
        { id: 'end', type: 'end' },
      ],
      edges: [
        { from: 'start', to: 'exec' },
        { from: 'exec', to: 'end' },
      ],
    });
    const projects = ctx.projectRepo.listAll();
    const projectId = projects[0]?.id ?? 'default';
    ctx.workflowRepo.create(id, projectId, name, def, 'draft', recurring ? cron : undefined);
    if (recurring) {
      ctx.taskScheduler.schedule(id, name, cron);
    }
    return c.json({ created: true, id });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// DELETE /api/scheduled-tasks/:id
scheduledTasksRouter.delete('/:id', (c) => {
  const ctx = getServerContext();
  const id = c.req.param('id');
  try {
    ctx.taskScheduler.unschedule(id);
    ctx.workflowRepo.updateCron(id, null);
    return c.json({ cancelled: true, id });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// POST /api/scheduled-tasks/:id/run — manual trigger
// TODO: Mastra workflows run via /api/workflows/:workflowId/start
scheduledTasksRouter.post('/:id/run', async (c) => {
  return c.json(
    { error: 'Workflow execution migrated to Mastra. Use /api/workflows/:workflowId/start' },
    410,
  );
});
