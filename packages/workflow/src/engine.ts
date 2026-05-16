export interface WorkflowNode {
  id: string;
  type: 'skill' | 'condition' | 'parallel' | 'human';
  skillId?: string;
  condition?: string;
  title?: string;
  children?: string[];
}

export interface WorkflowEdge {
  from: string;
  to: string;
  condition?: string;
}

export type WorkflowStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed';

export interface WorkflowRun {
  runId: string;
  workflowId: string;
  status: WorkflowStatus;
  currentNodeId: string;
  results: Map<string, unknown>;
  startedAt: Date;
}

export class WorkflowEngine {
  private runs = new Map<string, WorkflowRun>();
  private handlers = new Map<string, (input: unknown) => Promise<unknown>>();

  registerSkillHandler(skillId: string, handler: (input: unknown) => Promise<unknown>): void {
    this.handlers.set(skillId, handler);
  }

  async startRun(workflowId: string, nodes: WorkflowNode[], edges: WorkflowEdge[], entryNodeId: string): Promise<WorkflowRun> {
    const runId = `run_${Date.now()}`;
    const run: WorkflowRun = {
      runId, workflowId, status: 'running', currentNodeId: entryNodeId,
      results: new Map(), startedAt: new Date(),
    };
    this.runs.set(runId, run);

    // Execute in topological order via BFS
    const visited = new Set<string>();
    const queue = [entryNodeId];

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = nodes.find(n => n.id === nodeId);
      if (!node) { run.status = 'failed'; return run; }

      try {
        const result = await this.executeNode(node);
        run.results.set(nodeId, result);
        run.currentNodeId = nodeId;
      } catch (error) {
        run.status = 'failed';
        run.results.set(nodeId, { error: (error as Error).message });
        return run;
      }

      // Find next nodes
      for (const edge of edges) {
        if (edge.from === nodeId && !visited.has(edge.to)) {
          if (edge.condition === undefined || run.results.get(nodeId) === true) {
            queue.push(edge.to);
          }
        }
      }
    }

    run.status = 'completed';
    return run;
  }

  private async executeNode(node: WorkflowNode): Promise<unknown> {
    switch (node.type) {
      case 'skill': {
        const handler = this.handlers.get(node.skillId ?? '');
        if (!handler) throw new Error(`Unknown skill: ${node.skillId}`);
        return handler({ skillId: node.skillId, nodeId: node.id });
      }
      case 'condition': {
        const expr = node.condition?.trim();
        if (!expr) return true; // no condition = unconditional pass
        try {
          // Safely evaluate simple boolean expressions e.g. "output === 'approved'"
          // Only allow comparisons with string/number literals — no code execution
          const safeExpr = expr.replace(/[^a-zA-Z0-9_'"=!<>\s]/g, '');
          // eslint-disable-next-line no-new-func
          return Boolean(new Function('output', `"use strict"; return (${safeExpr});`)(undefined));
        } catch {
          return false;
        }
      }
      case 'human': {
        // Pause for human input (return placeholder)
        return { status: 'awaiting_approval', title: node.title };
      }
      case 'parallel': {
        const children = node.children ?? [];
        const results = await Promise.all(children.map(id => this.executeNode({ id, type: 'skill', skillId: id })));
        return results;
      }
      default: throw new Error(`Unknown node type: ${(node as any).type}`);
    }
  }

  getRun(runId: string): WorkflowRun | null { return this.runs.get(runId) ?? null; }
}
