import { Hono } from 'hono';
import { getServerContext } from '../../context.js';
import { broadcast } from '../../ws/handler.js';
import type { WorkflowCapabilities } from '@cabinet/types';
import { getEngine } from '../workflows/engine.js';
import { normalizeDefinition, findEntryNode } from '../workflows/normalize.js';
import { capabilityCache, agentLoopPool, setPendingCapabilities } from '../workflows/state.js';

export const workflowsRouter = new Hono();

workflowsRouter.get('/', (c) => {
  const { workflowRepo } = getServerContext();
  const projectId = c.req.query('projectId');
  const rows = projectId ? workflowRepo.listByProject(projectId) : workflowRepo.listAll();
  const workflows = rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    definition: JSON.parse(r.definition ?? '{}'),
    projectId: r.project_id,
    cronExpression: r.cron_expression ?? null,
    createdAt: r.created_at,
  }));
  return c.json({ workflows });
});

workflowsRouter.post('/', async (c) => {
  const { workflowRepo, taskScheduler } = getServerContext();
  const body = await c.req.json();
  if (!body.projectId) {
    return c.json({ error: 'projectId is required' }, 400);
  }
  const id = `wf_${Date.now()}`;
  const definition = body.definition ?? { nodes: body.nodes ?? [], edges: body.edges ?? [] };
  const cronExpression: string | undefined = body.cronExpression;
  try {
    workflowRepo.create(
      id,
      body.projectId,
      body.name ?? 'Untitled',
      JSON.stringify(definition),
      'draft',
      cronExpression,
    );
    if (cronExpression) {
      taskScheduler.schedule(id, body.name ?? 'Untitled', cronExpression);
    }
    return c.json({ id, status: 'created' });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

workflowsRouter.put('/:id', async (c) => {
  const { workflowRepo, taskScheduler } = getServerContext();
  const id = c.req.param('id');
  const body = await c.req.json();
  workflowRepo.updateNameAndDefinition(
    id,
    body.name ?? 'Untitled',
    JSON.stringify(body.definition ?? {}),
  );
  if (body.cronExpression !== undefined) {
    if (body.cronExpression) {
      taskScheduler.schedule(id, body.name ?? 'Untitled', body.cronExpression as string);
    } else {
      workflowRepo.updateCron(id, null);
      taskScheduler.unschedule(id);
    }
  }
  return c.json({ id, status: 'updated' });
});

/** Run a workflow by ID using the full engine (used by both HTTP API and MCP tool). */
export async function runWorkflowById(workflowId: string): Promise<{
  runId: string;
  status: string;
  steps: unknown[];
  handoffs: Record<string, unknown>;
}> {
  const { workflowRepo, auditLogRepo, logger, db } = getServerContext();
  const wf = workflowRepo.findById(workflowId);
  if (!wf) throw new Error(`Workflow not found: ${workflowId}`);

  const def = JSON.parse(wf.definition ?? '{}');
  const { nodes, edges } = normalizeDefinition(def);

  setPendingCapabilities((def.capabilities as WorkflowCapabilities) ?? {});
  capabilityCache.set(workflowId, (def.capabilities as WorkflowCapabilities) ?? {});

  if (nodes.length === 0) throw new Error('Workflow has no nodes');

  workflowRepo.updateStatus(workflowId, 'running');

  const eng = getEngine();
  const entryNodeId = findEntryNode(nodes);

  const run = await eng.startRun(workflowId, nodes, edges, entryNodeId);

  const finalStatus = run.status;
  workflowRepo.updateStatus(workflowId, finalStatus);
  auditLogRepo.insert('workflow', workflowId, 'run', 'system', {
    status: finalStatus,
    steps: run.steps,
    runId: run.runId,
  });

  const handoffs: Record<string, unknown> = {};
  for (const [key, value] of run.results) {
    if (key.startsWith('_handoff:')) {
      handoffs[key.replace('_handoff:', '')] = value;
    }
  }

  broadcast('workflow_started', {
    workflowId,
    runId: run.runId,
    name: wf.name,
    timestamp: new Date().toISOString(),
  });
  broadcast('workflow_completed', {
    workflowId,
    runId: run.runId,
    status: finalStatus,
    timestamp: new Date().toISOString(),
  });

  // Auto-create deliverable for completed workflows
  if (finalStatus === 'completed') {
    try {
      const deliverableId = `d_${Date.now()}`;
      const lastStep = run.steps[run.steps.length - 1];
      const output = lastStep ? String(lastStep.output ?? '') : '';
      db.prepare(
        `INSERT INTO project_deliverables (id, project_id, meeting_id, title, type, file_path, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        deliverableId,
        wf.project_id,
        null,
        wf.name || `Workflow ${workflowId}`,
        'workflow_output',
        '',
        JSON.stringify(['workflow', 'auto']),
      );
      broadcast('deliverable_created', {
        id: deliverableId,
        projectId: wf.project_id,
        title: wf.name || `Workflow ${workflowId}`,
        type: 'workflow_output',
        timestamp: new Date().toISOString(),
      });
    } catch {
      /* ignore deliverable creation errors */
    }
  }

  logger.info('Workflow executed', {
    id: workflowId,
    nodes: run.steps.length,
    runId: run.runId,
    status: finalStatus,
  });

  return { runId: run.runId, status: finalStatus, steps: run.steps, handoffs };
}

workflowsRouter.post('/:id/run', async (c) => {
  const { workflowRepo, logger } = getServerContext();
  const id = c.req.param('id');

  try {
    const result = await runWorkflowById(id);
    return c.json({
      runId: result.runId,
      workflowId: id,
      status: result.status,
      steps: result.steps,
      handoffs: Object.keys(result.handoffs).length > 0 ? result.handoffs : undefined,
    });
  } catch (e) {
    workflowRepo.updateStatus(id, 'failed');
    broadcast('workflow_completed', {
      workflowId: id,
      runId: '',
      status: 'failed',
      timestamp: new Date().toISOString(),
    });
    return c.json({ error: (e as Error).message }, 500);
  } finally {
    // Clean up agentLoop pool entries for this workflow run to prevent unbounded growth
    const runPrefix = `run_`;
    for (const key of agentLoopPool.keys()) {
      if (key.startsWith(runPrefix)) {
        agentLoopPool.get(key)?.resetHandoff();
        agentLoopPool.delete(key);
      }
    }
  }
});

workflowsRouter.delete('/:id', (c) => {
  const { workflowRepo, taskScheduler, logger } = getServerContext();
  const id = c.req.param('id');
  taskScheduler.unschedule(id);
  workflowRepo.delete(id);
  logger.info('Workflow deleted', { id });
  return c.json({ status: 'deleted' });
});

workflowsRouter.get('/:id/runs', (c) => {
  const { auditLogRepo } = getServerContext();
  const id = c.req.param('id');
  const rows = auditLogRepo.findByEntity('workflow', id, { limit: 20 });
  const runs = rows.map((r) => ({
    runId: r.id,
    workflowId: id,
    status: JSON.parse(r.changes ?? '{}').status ?? 'completed',
    steps: JSON.parse(r.changes ?? '{}').steps ?? [],
    timestamp: r.timestamp,
  }));
  return c.json({ runs, total: runs.length });
});

// ── Import/Export (M4 Operational Plane) ────────────────────────

// POST /api/workflows/export — export a workflow as cabinet-workflow/v1 blueprint
workflowsRouter.post('/export', async (c) => {
  const { workflowRepo } = getServerContext();
  const { exportBlueprint } = await import('@cabinet/workflow');
  try {
    const body = await c.req.json();
    const workflowId = body.workflowId as string;
    if (!workflowId) return c.json({ error: 'workflowId is required' }, 400);

    const wf = workflowRepo.findById(workflowId);
    if (!wf) return c.json({ error: 'Workflow not found' }, 404);

    const definition = JSON.parse(wf.definition);
    const nodes = definition.nodes ?? [];
    const edges = definition.edges ?? [];

    const blueprint = exportBlueprint(nodes, edges);
    return c.json(blueprint);
  } catch (err) {
    return c.json({ error: `Export failed: ${(err as Error).message}` }, 500);
  }
});

// POST /api/workflows/import — import a cabinet-workflow/v1 blueprint
workflowsRouter.post('/import', async (c) => {
  const { workflowRepo, projectRepo, agentRoleRepo } = getServerContext();
  const { importBlueprint, validateWorkflowExport } = await import('@cabinet/workflow');
  try {
    const body = await c.req.json();
    const blueprint = body.blueprint;
    const projectId = body.projectId as string;

    if (!blueprint) return c.json({ error: 'blueprint is required' }, 400);
    if (!projectId) return c.json({ error: 'projectId is required' }, 400);

    // Validate blueprint structure
    const issues = validateWorkflowExport(blueprint);
    if (issues.length > 0) {
      return c.json({ error: 'Invalid blueprint', issues }, 400);
    }

    // Import nodes and edges
    const { nodes, edges, resolvedAgents, missingAgents } = importBlueprint(blueprint);

    // Create the workflow in DB
    const id = `wf_${Date.now()}`;
    const name = body.name ?? `Imported: ${blueprint.definition.nodes[0]?.title ?? 'Workflow'}`;
    workflowRepo.create(id, projectId, name, JSON.stringify({ nodes, edges }), 'draft');

    return c.json({
      id,
      nodes: nodes.length,
      edges: edges.length,
      resolvedAgents,
      missingAgents,
    });
  } catch (err) {
    return c.json({ error: `Import failed: ${(err as Error).message}` }, 500);
  }
});

// POST /api/workflows/validate — validate a blueprint without importing
workflowsRouter.post('/validate', async (c) => {
  const { validateWorkflowExport } = await import('@cabinet/workflow');
  try {
    const body = await c.req.json();
    const blueprint = body.blueprint;
    if (!blueprint) return c.json({ error: 'blueprint is required' }, 400);

    const issues = validateWorkflowExport(blueprint);
    return c.json({ valid: issues.length === 0, issues });
  } catch (err) {
    return c.json({ error: `Validation failed: ${(err as Error).message}` }, 500);
  }
});
