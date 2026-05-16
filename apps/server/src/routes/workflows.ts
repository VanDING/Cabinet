import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import { broadcast } from '../ws/handler.js';
import { WorkflowEngine, type WorkflowNodeDef, type WorkflowEdge, type WorkflowRun } from '@cabinet/workflow';

// Shared engine instance with handlers wired at startup
let engine: WorkflowEngine | null = null;

function getEngine(): WorkflowEngine {
  if (engine) return engine;

  const ctx = getServerContext();
  engine = new WorkflowEngine();

  engine.setHandlers({
    aiAgent: async (node: WorkflowNodeDef, _previousOutputs: string) => {
      if (!ctx.gateway) return 'No LLM available';
      const d = node.data ?? {};
      try {
        const response = await ctx.gateway.generateText({
          model: (d.model as string) ?? 'claude-haiku-4-5',
          messages: [{ role: 'user', content: (d.prompt as string) ?? (d.label as string) ?? 'Process this step' }],
          maxTokens: (d.maxTokens as number) ?? 200,
        });
        ctx.metrics.increment('llm_call', { model: (d.model as string) ?? 'claude-haiku-4-5', purpose: 'workflow' });
        return response.content;
      } catch (e: any) {
        return `Error: ${e.message}`;
      }
    },

    humanApproval: async (node: WorkflowNodeDef, run: WorkflowRun) => {
      const { decisionService, db, logger } = getServerContext();
      const d = node.data ?? {};
      const decisionId = `dec_${Date.now()}`;

      decisionService.create({
        id: decisionId,
        projectId: 'default',
        type: 'action',
        title: `Workflow: ${(d.label as string) ?? node.id}`,
        description: `Workflow needs your approval at: ${(d.label as string) ?? node.id}.`,
        options: [
          { id: 'approve_continue', label: 'Approve & Continue', impact: 'Workflow proceeds to next step.' },
          { id: 'reject_terminate', label: 'Terminate', impact: 'Workflow stops immediately.' },
        ],
        classification: {
          scopeDescription: 'Workflow human approval',
          isCrossSession: true,
          optionCount: 2,
          estimatedCostUsd: 0,
          involvesFunds: false,
          involvesPermissions: false,
          involvesDataDeletion: false,
          involvesOrgConfig: false,
        },
      });

      db.prepare(
        "INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp) VALUES ('workflow_approval', ?, 'pending', 'system', ?, datetime('now'))",
      ).run(decisionId, JSON.stringify({ workflowId: run.workflowId, nodeId: node.id }));

      broadcast('decision_created', {
        decisionId,
        title: `Workflow: ${(d.label as string) ?? node.id}`,
        level: 'L1',
      });

      return { decisionId, status: 'pending' as const };
    },

    notification: async (node: WorkflowNodeDef) => {
      const d = node.data ?? {};
      broadcast('workflow_notification', {
        workflowId: '',
        nodeId: node.id,
        message: (d.message as string) ?? 'Notification sent',
      });
    },
  });

  return engine;
}

export const workflowsRouter = new Hono();

// Helper: convert UI-format definition to engine format
function normalizeDefinition(def: any): { nodes: WorkflowNodeDef[]; edges: WorkflowEdge[] } {
  const rawNodes: any[] = def.nodes ?? [];
  const rawEdges: any[] = def.edges ?? [];

  const nodes: WorkflowNodeDef[] = rawNodes.map((n: any) => ({
    id: n.id,
    type: n.type ?? n.data?.type ?? 'skill',
    skillId: n.skillId ?? n.data?.skillId,
    condition: n.condition ?? n.data?.condition,
    title: n.title ?? n.data?.label ?? n.data?.title,
    children: n.children ?? n.data?.children,
    data: n.data ?? {},
  }));

  const edges: WorkflowEdge[] = rawEdges.map((e: any) => ({
    from: e.from ?? e.source,
    to: e.to ?? e.target,
    condition: e.condition,
  }));

  return { nodes, edges };
}

// Helper: find entry node (first start node, or first node)
function findEntryNode(nodes: WorkflowNodeDef[]): string {
  const start = nodes.find((n) => n.type === 'start');
  if (start) return start.id;
  return nodes[0]?.id ?? '';
}

// ── Workflow resumption (called by decision callback) ──
export async function resumeWorkflowAfterApproval(workflowId: string): Promise<void> {
  const { db, logger } = getServerContext();

  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId) as any;
  if (!wf) throw new Error(`Workflow not found: ${workflowId}`);

  const def = JSON.parse(wf.definition ?? '{}');
  const { nodes, edges } = normalizeDefinition(def);

  // Find the approval node that triggered this resume
  const approvalNode = nodes.find((n) => n.type === 'humanApproval');
  if (!approvalNode) {
    logger.warn('No approval node found for resume', { workflowId });
    return;
  }

  const eng = getEngine();
  // Start a run at the approval node — engine will pause at humanApproval
  let run = await eng.startRun(workflowId, nodes, edges, approvalNode.id);

  if (run.status === 'awaiting_approval') {
    // Mark as approved and continue from this node
    run.status = 'running';
    run = await eng.continueRun(run.runId, nodes, edges);
  }

  // Persist results
  const finalStatus: string = run.status === 'awaiting_approval' ? 'awaiting_approval' : 'completed';
  db.prepare('UPDATE workflows SET status = ? WHERE id = ?').run(finalStatus, workflowId);
  db.prepare(
    "INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp) VALUES ('workflow', ?, 'resume', 'system', ?, datetime('now'))",
  ).run(workflowId, JSON.stringify({ status: finalStatus, steps: run.steps, runId: run.runId }));

  logger.info('Workflow resumed after approval', { workflowId, nodes: run.steps.length, status: finalStatus });
}

// ── Routes ──

workflowsRouter.get('/', (c) => {
  const { db } = getServerContext();
  const projectId = c.req.query('projectId') ?? 'proj-1';
  const rows = db
    .prepare('SELECT * FROM workflows WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId) as any[];
  const workflows = rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    definition: JSON.parse(r.definition ?? '{}'),
    projectId: r.project_id,
    createdAt: r.created_at,
  }));
  return c.json({ workflows });
});

workflowsRouter.post('/', async (c) => {
  const { db } = getServerContext();
  const body = await c.req.json();
  const id = `wf_${Date.now()}`;
  const definition = body.definition ?? { nodes: body.nodes ?? [], edges: body.edges ?? [] };
  try {
    db.prepare(
      'INSERT INTO workflows (id, project_id, name, definition, status) VALUES (?, ?, ?, ?, ?)',
    ).run(id, body.projectId ?? 'proj-1', body.name ?? 'Untitled', JSON.stringify(definition), 'draft');
    return c.json({ id, status: 'created' });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

workflowsRouter.put('/:id', async (c) => {
  const { db } = getServerContext();
  const id = c.req.param('id');
  const body = await c.req.json();
  db.prepare('UPDATE workflows SET name = ?, definition = ? WHERE id = ?').run(
    body.name ?? 'Untitled',
    JSON.stringify(body.definition ?? {}),
    id,
  );
  return c.json({ id, status: 'updated' });
});

workflowsRouter.post('/:id/run', async (c) => {
  const { db, logger } = getServerContext();
  const id = c.req.param('id');

  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as any;
  if (!wf) return c.json({ error: 'Workflow not found' }, 404);

  const def = JSON.parse(wf.definition ?? '{}');
  const { nodes, edges } = normalizeDefinition(def);

  if (nodes.length === 0) {
    return c.json({ error: 'Workflow has no nodes' }, 400);
  }

  db.prepare('UPDATE workflows SET status = ? WHERE id = ?').run('running', id);

  const eng = getEngine();
  const entryNodeId = findEntryNode(nodes);

  try {
    const run = await eng.startRun(id, nodes, edges, entryNodeId);

    const finalStatus = run.status;
    db.prepare('UPDATE workflows SET status = ? WHERE id = ?').run(finalStatus, id);
    db.prepare(
      "INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp) VALUES ('workflow', ?, 'run', 'system', ?, datetime('now'))",
    ).run(id, JSON.stringify({ status: finalStatus, steps: run.steps, runId: run.runId }));

    logger.info('Workflow executed', { id, nodes: run.steps.length, status: finalStatus });
    return c.json({
      runId: run.runId,
      workflowId: id,
      status: finalStatus,
      steps: run.steps,
    });
  } catch (e) {
    db.prepare('UPDATE workflows SET status = ? WHERE id = ?').run('failed', id);
    return c.json({ error: (e as Error).message }, 500);
  }
});

workflowsRouter.delete('/:id', (c) => {
  const { db, logger } = getServerContext();
  const id = c.req.param('id');
  db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
  logger.info('Workflow deleted', { id });
  return c.json({ status: 'deleted' });
});

workflowsRouter.get('/:id/runs', (c) => {
  const { db } = getServerContext();
  const id = c.req.param('id');
  const rows = db
    .prepare(
      "SELECT * FROM audit_log WHERE entity_type = 'workflow' AND entity_id = ? ORDER BY timestamp DESC LIMIT 20",
    )
    .all(id) as any[];
  const runs = rows.map((r: any) => ({
    runId: r.event_id ?? r.id,
    workflowId: id,
    status: JSON.parse(r.changes ?? '{}').status ?? 'completed',
    steps: JSON.parse(r.changes ?? '{}').steps ?? [],
    timestamp: r.timestamp,
  }));
  return c.json({ runs, total: runs.length });
});
