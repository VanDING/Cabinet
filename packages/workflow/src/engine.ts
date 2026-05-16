export type WorkflowNodeType =
  | 'start' | 'end'
  | 'skill' | 'aiAgent' | 'llmCall'
  | 'condition' | 'parallel'
  | 'human' | 'humanApproval'
  | 'dataQuery' | 'notification' | 'wait';

export interface WorkflowNodeDef {
  id: string;
  type: WorkflowNodeType;
  skillId?: string;
  condition?: string;
  title?: string;
  children?: string[];
  /** Arbitrary data attached to the node (prompt, model, label, duration, message, etc.). */
  data?: Record<string, unknown>;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  condition?: string;
}

export type WorkflowStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'awaiting_approval';

export interface WorkflowRun {
  runId: string;
  workflowId: string;
  status: WorkflowStatus;
  currentNodeId: string;
  results: Map<string, unknown>;
  /** Ordered steps executed so far. */
  steps: { nodeId: string; type: WorkflowNodeType; output: string }[];
  startedAt: Date;
}

export interface WorkflowHandlers {
  aiAgent?: (node: WorkflowNodeDef, previousOutputs: string) => Promise<string>;
  humanApproval?: (node: WorkflowNodeDef, run: WorkflowRun) => Promise<{ decisionId: string; status: 'approved' | 'pending' }>;
  dataQuery?: (node: WorkflowNodeDef) => Promise<string>;
  notification?: (node: WorkflowNodeDef) => Promise<void>;
  wait?: (node: WorkflowNodeDef) => Promise<void>;
  skill?: (skillId: string, input: unknown) => Promise<unknown>;
}

export class WorkflowEngine {
  private runs = new Map<string, WorkflowRun>();
  private handlers: WorkflowHandlers = {};

  setHandlers(handlers: WorkflowHandlers): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  async startRun(
    workflowId: string,
    nodes: WorkflowNodeDef[],
    edges: WorkflowEdge[],
    entryNodeId: string,
  ): Promise<WorkflowRun> {
    const runId = `run_${Date.now()}`;
    const run: WorkflowRun = {
      runId,
      workflowId,
      status: 'running',
      currentNodeId: entryNodeId,
      results: new Map(),
      steps: [],
      startedAt: new Date(),
    };
    this.runs.set(runId, run);

    const graph = this.buildGraph(nodes, edges);
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    try {
      await this.executeNode(entryNodeId, nodeMap, graph, run, new Set());
    } catch (error) {
      run.status = 'failed';
      return run;
    }

    if (run.status === 'running') {
      run.status = 'completed';
    }
    return run;
  }

  /**
   * Continue a paused run (e.g., after human approval) from its currentNodeId.
   */
  async continueRun(
    runId: string,
    nodes: WorkflowNodeDef[],
    edges: WorkflowEdge[],
  ): Promise<WorkflowRun> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (run.status !== 'awaiting_approval' && run.status !== 'paused') {
      throw new Error(`Cannot continue run with status: ${run.status}`);
    }

    run.status = 'running';

    const graph = this.buildGraph(nodes, edges);
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // Execute children of the current (just-approved) node
    const children = graph.get(run.currentNodeId) ?? [];
    const visited = new Set(run.steps.map((s) => s.nodeId));

    try {
      for (const child of children) {
        if (!visited.has(child)) {
          await this.executeNode(child, nodeMap, graph, run, visited);
        }
      }
    } catch (error) {
      run.status = 'failed';
      return run;
    }

    if (run.status === 'running') {
      run.status = 'completed';
    }
    return run;
  }

  getRun(runId: string): WorkflowRun | null {
    return this.runs.get(runId) ?? null;
  }

  // ── Private ──

  private buildGraph(
    nodes: WorkflowNodeDef[],
    edges: WorkflowEdge[],
  ): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    for (const n of nodes) graph.set(n.id, []);
    for (const e of edges) {
      if (!graph.has(e.from)) graph.set(e.from, []);
      graph.get(e.from)!.push(e.to);
    }
    return graph;
  }

  private async executeNode(
    nodeId: string,
    nodeMap: Map<string, WorkflowNodeDef>,
    graph: Map<string, string[]>,
    run: WorkflowRun,
    visited: Set<string>,
  ): Promise<void> {
    if (visited.has(nodeId)) return;
    const node = nodeMap.get(nodeId);
    if (!node) return;
    visited.add(nodeId);

    const previousOutputs = run.steps
      .map((s) => s.output)
      .join('\n');

    let output = '';
    const d = node.data ?? {};

    switch (node.type) {
      case 'start':
        output = 'Workflow started';
        break;

      case 'end':
        output = 'Workflow ended';
        break;

      case 'skill': {
        if (!this.handlers.skill) throw new Error('No skill handler registered');
        const result = await this.handlers.skill(node.skillId ?? node.id, { nodeId, previousOutputs });
        output = typeof result === 'string' ? result : JSON.stringify(result);
        break;
      }

      case 'aiAgent':
      case 'llmCall': {
        if (!this.handlers.aiAgent) throw new Error('No aiAgent handler registered');
        output = await this.handlers.aiAgent(node, previousOutputs);
        break;
      }

      case 'condition': {
        // Evaluate condition against previous outputs
        const conditionExpr = (node.condition ?? d.condition ?? 'true') as string;
        const isTrue = this.evaluateCondition(conditionExpr, previousOutputs);
        output = `Condition evaluated: ${isTrue}`;

        run.steps.push({ nodeId, type: node.type, output });
        run.results.set(nodeId, output);
        run.currentNodeId = nodeId;

        // Execute matching branch only
        const children = graph.get(nodeId) ?? [];
        if (children.length >= 2) {
          const targetIdx = isTrue ? 0 : Math.min(1, children.length - 1);
          const targetNode = children[targetIdx];
          if (targetNode) {
            await this.executeNode(targetNode, nodeMap, graph, run, visited);
          }
        } else {
          if (isTrue) {
            for (const child of children) {
              await this.executeNode(child, nodeMap, graph, run, visited);
            }
          }
        }
        return; // Already handled children
      }

      case 'parallel': {
        const children = node.children ?? [];
        const childResults = await Promise.allSettled(
          children.map((id) => this.executeNode(id, nodeMap, graph, run, visited)),
        );
        output = childResults
          .map((r) => (r.status === 'fulfilled' ? 'ok' : `error: ${String((r as any).reason)}`))
          .join(', ');
        break;
      }

      case 'human':
      case 'humanApproval': {
        if (!this.handlers.humanApproval) throw new Error('No humanApproval handler registered');
        const decision = await this.handlers.humanApproval(node, run);
        if (decision.status === 'pending') {
          output = `Approval pending: decision ${decision.decisionId}`;
          run.status = 'awaiting_approval';
        } else {
          output = 'Approval granted';
        }
        break;
      }

      case 'dataQuery': {
        if (!this.handlers.dataQuery) throw new Error('No dataQuery handler registered');
        output = await this.handlers.dataQuery(node);
        break;
      }

      case 'notification': {
        if (this.handlers.notification) {
          await this.handlers.notification(node);
        }
        output = (d.message as string) ?? 'Notification sent';
        break;
      }

      case 'wait': {
        if (this.handlers.wait) {
          await this.handlers.wait(node);
        }
        output = `Waited ${(d.duration as string) ?? '5s'}`;
        break;
      }

      default:
        throw new Error(`Unknown node type: ${(node as any).type}`);
    }

    run.steps.push({ nodeId, type: node.type, output });
    run.results.set(nodeId, output);
    run.currentNodeId = nodeId;

    // If run was paused (humanApproval), stop execution
    if (run.status === 'awaiting_approval') return;

    // Execute downstream nodes
    const children = graph.get(nodeId) ?? [];
    for (const child of children) {
      if (!visited.has(child)) {
        await this.executeNode(child, nodeMap, graph, run, visited);
      }
    }
  }

  private evaluateCondition(expr: string, previousOutputs: string): boolean {
    if (!expr || expr === 'true') return true;
    if (expr === 'false') return false;
    const lower = previousOutputs.toLowerCase();
    if (expr.includes('approved')) return lower.includes('approved');
    if (expr.includes('true')) return lower.includes('true') || lower.includes('approved');
    // Fallback string match
    return lower.includes(expr.toLowerCase());
  }
}
