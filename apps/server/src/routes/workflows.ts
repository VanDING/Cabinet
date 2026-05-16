import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import { broadcast } from '../ws/handler.js';

export const workflowsRouter = new Hono();

// ── Workflow resumption helper (also used by decision callback) ──
export async function resumeWorkflowAfterApproval(workflowId: string): Promise<void> {
  const { db, gateway, metrics, logger } = getServerContext();

  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId) as any;
  if (!wf) throw new Error(`Workflow not found: ${workflowId}`);

  const def = JSON.parse(wf.definition ?? '{}');
  const nodes: { id: string; type: string; data: any }[] = def.nodes ?? [];
  const edges: { source: string; target: string }[] = def.edges ?? [];

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const graph = new Map<string, string[]>();
  for (const n of nodes) graph.set(n.id, []);
  for (const e of edges) {
    if (!graph.has(e.source)) graph.set(e.source, []);
    graph.get(e.source)!.push(e.target);
  }

  // Find the humanApproval node (there should be one awaiting_approval)
  const approvalNode = nodes.find(n => n.type === 'humanApproval');
  if (!approvalNode) { logger.warn('No approval node found for resume', { workflowId }); return; }

  const results: { nodeId: string; type: string; output: string }[] = [];
  const visited = new Set<string>([approvalNode.id]);

  // Mark previous nodes as visited (they've already executed)
  // Simple heuristic: nodes before the approval node in the BFS order
  const bfsOrder: string[] = [];
  const queue = nodes.filter(n => n.type === 'start').map(n => n.id);
  const seen = new Set<string>();
  while (queue.length > 0) {
    const nid = queue.shift()!;
    if (seen.has(nid)) continue;
    seen.add(nid);
    bfsOrder.push(nid);
    if (nid === approvalNode.id) break;
    const children = graph.get(nid) ?? [];
    for (const c of children) queue.push(c);
  }
  // Mark all nodes before the approval node as visited
  const approvalIdx = bfsOrder.indexOf(approvalNode.id);
  for (let i = 0; i < approvalIdx; i++) {
    visited.add(bfsOrder[i]!);
  }

  results.push({ nodeId: approvalNode.id, type: 'humanApproval', output: 'Approval granted' });

  async function executeNode(nodeId: string): Promise<void> {
    if (visited.has(nodeId)) return;
    const node = nodeMap.get(nodeId);
    if (!node) return;
    visited.add(nodeId);

    const d = node.data ?? {};
    let output = '';

    switch (node.type) {
      case 'start':
        output = 'Workflow started';
        break;
      case 'end':
        output = 'Workflow ended';
        break;
      case 'aiAgent':
      case 'llmCall':
        if (!gateway) { output = 'No LLM available'; break; }
        try {
          const response = await gateway.generateText({
            model: d.model ?? 'claude-haiku-4-5',
            messages: [{ role: 'user', content: d.prompt ?? d.label ?? 'Process this step' }],
            maxTokens: 200,
          });
          output = response.content;
          metrics.increment('llm_call', { model: d.model ?? 'claude-haiku-4-5', purpose: 'workflow' });
        } catch (e: any) { output = `Error: ${e.message}`; }
        break;
      case 'humanApproval':
        // If we hit another approval node, create another decision and pause again
        {
          const { decisionService } = getServerContext();
          const decisionId = `dec_${Date.now()}`;
          decisionService.create({
            id: decisionId,
            projectId: wf.project_id ?? 'default',
            type: 'action',
            title: `Workflow: ${d.label ?? nodeId}`,
            description: `Workflow "${wf.name}" needs your approval at: ${d.label ?? nodeId}.`,
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
            "INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp) VALUES ('workflow_approval', ?, 'pending', 'system', ?, datetime('now'))"
          ).run(decisionId, JSON.stringify({ workflowId, nodeId: node.id }));
          db.prepare("UPDATE workflows SET status = 'awaiting_approval' WHERE id = ?").run(workflowId);
          broadcast('decision_created', { decisionId, title: `Workflow: ${d.label ?? nodeId}`, level: 'L1' });
          output = `Approval pending: decision ${decisionId}`;
        }
        break;
      case 'condition': {
        const prevOutputs = results.map(r => r.output.toLowerCase()).join(' ');
        const isTrue = prevOutputs.includes('approved') || prevOutputs.includes('true');
        const children = graph.get(nodeId) ?? [];
        if (children.length >= 2) {
          const targetIdx = isTrue ? 0 : Math.min(1, children.length - 1);
          const targetNode = children[targetIdx];
          if (targetNode) await executeNode(targetNode);
        } else {
          for (const child of children) await executeNode(child);
        }
        results.push({ nodeId, type: 'condition', output: `Condition: ${isTrue}` });
        return;
      }
      case 'dataQuery':
        output = 'Data query executed';
        break;
      case 'notification':
        output = d.message ?? 'Notification sent';
        broadcast('workflow_notification', { workflowId, nodeId, message: output });
        break;
      case 'wait':
        output = `Waited ${d.duration ?? '5s'}`;
        break;
      default:
        output = 'Unknown node type';
    }

    results.push({ nodeId, type: node.type ?? 'unknown', output });

    const children = graph.get(nodeId) ?? [];
    for (const child of children) await executeNode(child);
  }

  // Execute children of the approval node
  const children = graph.get(approvalNode.id) ?? [];
  for (const child of children) await executeNode(child);

  const finalStatus = results.some(r => r.type === 'humanApproval' && r.output.includes('pending'))
    ? 'awaiting_approval' : 'completed';
  db.prepare('UPDATE workflows SET status = ? WHERE id = ?').run(finalStatus, workflowId);
  db.prepare(
    "INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp) VALUES ('workflow', ?, 'resume', 'system', ?, datetime('now'))"
  ).run(workflowId, JSON.stringify({ status: finalStatus, steps: results }));
  logger.info('Workflow resumed after approval', { workflowId, nodes: results.length, status: finalStatus });
}

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
  // Accept both legacy {name, nodes, edges} and {name, definition: {nodes, edges}} formats
  const definition = body.definition ?? { nodes: body.nodes ?? [], edges: body.edges ?? [] };
  try {
    db.prepare(
      'INSERT INTO workflows (id, project_id, name, definition, status) VALUES (?, ?, ?, ?, ?)'
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

  const def = JSON.parse(wf.definition ?? '{}');
  const nodes: { id: string; type: string; data: any }[] = def.nodes ?? [];
  const edges: { source: string; target: string }[] = def.edges ?? [];

  if (nodes.length === 0) {
    return c.json({ error: 'Workflow has no nodes' }, 400);
  }

  db.prepare('UPDATE workflows SET status = ? WHERE id = ?').run('running', id);

  // Build adjacency map
  const graph = new Map<string, string[]>();
  for (const n of nodes) graph.set(n.id, []);
  for (const e of edges) {
    if (!graph.has(e.source)) graph.set(e.source, []);
    graph.get(e.source)!.push(e.target);
  }

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const results: { nodeId: string; type: string; output: string }[] = [];

  // Depth-first DAG traversal with condition branching
  async function executeNode(nodeId: string, visited: Set<string>): Promise<void> {
    if (visited.has(nodeId)) return;
    const node = nodeMap.get(nodeId);
    if (!node) return;
    visited.add(nodeId);

    const d = node.data ?? {};
    let output = '';

    switch (node.type) {
      case 'start':
        output = 'Workflow started';
        break;
      case 'end':
        output = 'Workflow ended';
        break;
      case 'aiAgent':
      case 'llmCall':
        if (!gateway) { output = 'No LLM available'; break; }
        try {
          const response = await gateway.generateText({
            model: d.model ?? 'claude-haiku-4-5',
            messages: [{ role: 'user', content: d.prompt ?? d.label ?? 'Process this step' }],
            maxTokens: 200,
          });
          output = response.content;
          metrics.increment('llm_call', { model: d.model ?? 'claude-haiku-4-5', purpose: 'workflow' });
        } catch (e: any) { output = `Error: ${e.message}`; }
        break;
      case 'humanApproval': {
        // Create a Decision instead of broadcasting a special event
        const { decisionService: ds } = getServerContext();
        const decisionId = `dec_${Date.now()}`;
        ds.create({
          id: decisionId,
          projectId: wf.project_id ?? 'default',
          type: 'action',
          title: `Workflow: ${d.label ?? nodeId}`,
          description: `Workflow "${wf.name}" needs your approval at: ${d.label ?? nodeId}.`,
          options: [
            { id: 'approve_continue', label: 'Approve & Continue', impact: 'Workflow proceeds to next step.' },
            { id: 'reject_terminate', label: 'Terminate', impact: 'Workflow stops immediately.' },
          ],
          classification: {
            scopeDescription: 'Workflow human approval',
            isCrossSession: true, optionCount: 2, estimatedCostUsd: 0,
            involvesFunds: false, involvesPermissions: false,
            involvesDataDeletion: false, involvesOrgConfig: false,
          },
        });
        db.prepare(
          "INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp) VALUES ('workflow_approval', ?, 'pending', 'system', ?, datetime('now'))"
        ).run(decisionId, JSON.stringify({ workflowId: id, nodeId }));
        db.prepare("UPDATE workflows SET status = ? WHERE id = ?").run('awaiting_approval', id);
        broadcast('decision_created', { decisionId, title: `Workflow: ${d.label ?? nodeId}`, level: 'L1' });
        output = `Approval pending: decision ${decisionId}`;
        break;
      }
      case 'condition': {
        const condition = d.condition ?? 'true';
        output = `Condition: ${condition}`;
        // Execute only matching branch
        const children = graph.get(nodeId) ?? [];
        // Simple condition: check if any previous output contains 'approved' or 'true'
        const prevOutputs = results.map(r => r.output.toLowerCase()).join(' ');
        const isTrue = prevOutputs.includes('approved') || prevOutputs.includes('true') || condition === 'true';
        if (children.length >= 2) {
          const targetIdx = isTrue ? 0 : Math.min(1, children.length - 1);
          const targetNode = children[targetIdx];
          if (targetNode) await executeNode(targetNode, visited);
        } else {
          for (const child of children) await executeNode(child, visited);
        }
        results.push({ nodeId, type: 'condition', output });
        return; // Already handled children
      }
      case 'dataQuery':
        output = 'Data query executed';
        break;
      case 'notification':
        output = d.message ?? 'Notification sent';
        broadcast('workflow_notification', { workflowId: id, runId, nodeId, message: output });
        break;
      case 'wait':
        output = `Waited ${d.duration ?? '5s'}`;
        break;
      default:
        output = 'Unknown node type';
    }

    results.push({ nodeId, type: node.type ?? 'unknown', output });

    // Execute downstream nodes
    const children = graph.get(nodeId) ?? [];
    for (const child of children) await executeNode(child, visited);
  }

  // Find start node and begin execution
  const startNodes = nodes.filter(n => n.type === 'start');
  const visited = new Set<string>();

  try {
    if (startNodes.length > 0 && startNodes[0]) {
      await executeNode(startNodes[0].id, visited);
    } else {
      // No start node: execute all nodes in order
      for (const n of nodes) await executeNode(n.id, visited);
    }

    const finalStatus = results.some(r => r.type === 'humanApproval' && r.output.includes('pending'))
      ? 'awaiting_approval' : 'completed';
    db.prepare('UPDATE workflows SET status = ? WHERE id = ?').run(finalStatus, id);
    db.prepare(
      "INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp) VALUES ('workflow', ?, 'run', 'system', ?, datetime('now'))"
    ).run(id, JSON.stringify({ status: finalStatus, steps: results, runId }));
    logger.info('Workflow executed', { id, nodes: results.length, status: finalStatus });
    return c.json({ runId, workflowId: id, status: finalStatus, steps: results });
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
  const rows = db.prepare(
    "SELECT * FROM audit_log WHERE entity_type = 'workflow' AND entity_id = ? ORDER BY timestamp DESC LIMIT 20"
  ).all(id) as any[];
  const runs = rows.map((r: any) => ({
    runId: r.event_id ?? r.id,
    workflowId: id,
    status: JSON.parse(r.changes ?? '{}').status ?? 'completed',
    steps: JSON.parse(r.changes ?? '{}').steps ?? [],
    timestamp: r.timestamp,
  }));
  return c.json({ runs, total: runs.length });
});
