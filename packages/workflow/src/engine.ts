import type { Database } from '@cabinet/storage';
import { evaluateCondition as evaluateExpr, type ConditionContext } from './condition-evaluator.js';

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
  /** Reference to a role in AgentRoleRegistry. Consecutive nodes with same agentId form a segment. */
  agentId?: string;
  /** Runtime configuration for this node's agent segment. */
  agentConfig?: {
    /** Keep context alive across segment boundaries (for persistent service agents). */
    persistent?: boolean;
    /** Explicit segment grouping key (auto-detected from consecutive agentId if omitted). */
    segmentId?: string;
  };
}

/** Lightweight handle for an AgentLoop instance. Keeps engine decoupled from @cabinet/agent. */
export interface AgentLoopHandle {
  run(message: string): Promise<string>;
  dispose(): Promise<void>;
  handoff(): Promise<string>;
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
  /** @internal Active AgentLoop segment during execution. */
  _agentLoop?: { agentId: string; handle: AgentLoopHandle } | null;
}

export interface WorkflowHandlers {
  /** @deprecated Use createAgentLoop for segment-based agent execution. */
  aiAgent?: (node: WorkflowNodeDef, previousOutputs: string) => Promise<string>;
  /** Create an AgentLoop instance from a registered agent role. Segment-based replacement for aiAgent. */
  createAgentLoop?: (
    agentId: string,
    runId: string,
    options: { persistent?: boolean; segmentId?: string },
  ) => Promise<AgentLoopHandle>;
  humanApproval?: (node: WorkflowNodeDef, run: WorkflowRun) => Promise<{ decisionId: string; status: 'approved' | 'pending' }>;
  dataQuery?: (node: WorkflowNodeDef) => Promise<string>;
  notification?: (node: WorkflowNodeDef) => Promise<void>;
  wait?: (node: WorkflowNodeDef) => Promise<void>;
  skill?: (skillId: string, input: unknown) => Promise<unknown>;
}

export class WorkflowEngine {
  private runs = new Map<string, WorkflowRun>();
  private handlers: WorkflowHandlers = {};
  private db: Database | null = null;

  setHandlers(handlers: WorkflowHandlers): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  setDb(db: Database): void {
    this.db = db;
  }

  async startRun(
    workflowId: string,
    nodes: WorkflowNodeDef[],
    edges: WorkflowEdge[],
    entryNodeId: string,
  ): Promise<WorkflowRun> {
    // Check for incomplete runs that can be resumed
    const incomplete = this.listIncompleteRuns(workflowId);
    if (incomplete.length > 0) {
      const existing = incomplete[0]!;
      this.runs.set(existing.runId, existing);
      return this.continueRun(existing.runId, nodes, edges);
    }

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
    this.saveRun(run);

    const graph = this.buildGraph(nodes, edges);
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    try {
      await this.executeNode(entryNodeId, nodeMap, graph, run, new Set());
      // Finalize any remaining AgentLoop segment
      await this.finalizeAgentSegment(run);
    } catch (error) {
      await this.finalizeAgentSegment(run);
      run.status = 'failed';
      this.saveRun(run);
      return run;
    }

    if (run.status === 'running') {
      run.status = 'completed';
      this.saveRun(run);
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
    run._agentLoop = null; // Clear any stale agent segment from before the pause

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
      this.saveRun(run);
      return run;
    }

    if (run.status === 'running') {
      run.status = 'completed';
      this.saveRun(run);
    }
    return run;
  }

  getRun(runId: string): WorkflowRun | null {
    const memRun = this.runs.get(runId);
    if (memRun) return memRun;
    return this.loadRun(runId);
  }

  // ── Segment Helpers ───────────────────────────────────────────

  /**
   * Group consecutive aiAgent/llmCall nodes with the same agentId into segments.
   * Non-AI nodes act as segment boundaries.
   */
  groupNodesIntoSegments(
    nodes: WorkflowNodeDef[],
    orderedIds: string[],
  ): WorkflowNodeDef[][] {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const segments: WorkflowNodeDef[][] = [];
    let current: WorkflowNodeDef[] = [];
    let currentAgentId: string | undefined;

    for (const id of orderedIds) {
      const node = nodeMap.get(id);
      if (!node) continue;

      if (node.type === 'aiAgent' || node.type === 'llmCall') {
        const agentId = node.agentId ?? 'secretary';
        if (agentId !== currentAgentId) {
          if (current.length > 0) segments.push(current);
          current = [node];
          currentAgentId = agentId;
        } else {
          current.push(node);
        }
      } else {
        // Non-AI node breaks the segment
        if (current.length > 0) {
          segments.push(current);
          current = [];
          currentAgentId = undefined;
        }
      }
    }
    if (current.length > 0) segments.push(current);
    return segments;
  }

  /**
   * Execute a segment of AI nodes using a shared AgentLoop instance.
   * The same AgentLoop handles all nodes in the segment, maintaining context.
   */
  async executeSegment(
    segmentNodes: WorkflowNodeDef[],
    agentLoop: AgentLoopHandle,
    previousOutputs: string,
  ): Promise<{ outputs: string[]; handoffDoc?: string }> {
    const outputs: string[] = [];
    let accumulatedContext = previousOutputs;

    for (let i = 0; i < segmentNodes.length; i++) {
      const node = segmentNodes[i]!;
      const d = node.data ?? {};
      const prompt = (d.prompt as string) ?? (d.label as string) ?? 'Process this step';

      // Build message with accumulated context from previous nodes in this segment
      const message =
        i === 0 && accumulatedContext
          ? `${prompt}\n\n[Previous outputs]\n${accumulatedContext}`
          : prompt;

      const output = await agentLoop.run(message);
      outputs.push(output);
      accumulatedContext += `\n[${node.id} output]\n${output}`;
    }

    // Generate handoff at segment end
    const handoffDoc = await agentLoop.handoff();
    return { outputs, handoffDoc };
  }

  // ── Agent segment lifecycle ──

  private async finalizeAgentSegment(run: WorkflowRun): Promise<void> {
    if (run._agentLoop) {
      try {
        const handoffDoc = await run._agentLoop.handle.handoff();
        run.results.set(`_handoff:${run._agentLoop.agentId}`, handoffDoc);
        await run._agentLoop.handle.dispose();
      } catch {
        /* cleanup failure is non-fatal */
      }
      run._agentLoop = null;
    }
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

    // Non-AI nodes act as segment boundaries — finalize active AgentLoop
    if (node.type !== 'aiAgent' && node.type !== 'llmCall') {
      await this.finalizeAgentSegment(run);
    }

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
        const agentId = node.agentId ?? 'secretary';
        const children = graph.get(nodeId) ?? [];
        const nextChildIsSameAgent = children.some((cid) => {
          const child = nodeMap.get(cid);
          return child && (child.type === 'aiAgent' || child.type === 'llmCall') && (child.agentId ?? 'secretary') === agentId;
        });

        // Reuse or create AgentLoop for this segment
        if (!run._agentLoop || run._agentLoop.agentId !== agentId) {
          // Finalize previous segment if exists
          if (run._agentLoop) {
            const handoffDoc = await run._agentLoop.handle.handoff();
            await run._agentLoop.handle.dispose();
            run.results.set(`_handoff:${run._agentLoop.agentId}`, handoffDoc);
          }
          // Create new segment
          if (this.handlers.createAgentLoop) {
            const handle = await this.handlers.createAgentLoop(agentId, run.runId, {
              persistent: node.agentConfig?.persistent,
              segmentId: node.agentConfig?.segmentId,
            });
            run._agentLoop = { agentId, handle };
          } else if (this.handlers.aiAgent) {
            // Fallback to legacy per-node handler
            output = await this.handlers.aiAgent(node, previousOutputs);
            break;
          } else {
            output = 'No agent handler registered';
            break;
          }
        }

        // Execute with shared AgentLoop
        const d = node.data ?? {};
        const prompt = (d.prompt as string) ?? (d.label as string) ?? 'Process this step';
        output = await run._agentLoop.handle.run(prompt);

        // If no child shares this agent, finalize the segment
        if (!nextChildIsSameAgent) {
          const handoffDoc = await run._agentLoop.handle.handoff();
          await run._agentLoop.handle.dispose();
          run.results.set(`_handoff:${agentId}`, handoffDoc);
          run._agentLoop = null;
        }
        break;
      }

      case 'condition': {
        // Evaluate condition against previous outputs
        const conditionExpr = (node.condition ?? d.condition ?? 'true') as string;
        const isTrue = this.evaluateCondition(conditionExpr, previousOutputs, run);
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
        const aggregation = (d.aggregation as string) ?? 'all';

        if (aggregation === 'first') {
          // Race: take the first successful child result
          let firstOutput = '';
          let settled = false;
          const pending = children.map(async (id) => {
            // Each child is a promise that resolves when executeNode completes
            return new Promise<string>((resolve) => {
              // Wrap executeNode to capture its output
              this.executeNode(id, nodeMap, graph, run, visited).then(() => {
                const childStep = run.steps.find((s) => s.nodeId === id);
                if (!settled) {
                  settled = true;
                  firstOutput = childStep?.output ?? '';
                  resolve(firstOutput);
                }
              });
            });
          });
          await Promise.any(pending);
          // Kill remaining... we can't easily cancel, but we can mark
          output = firstOutput || 'No child completed';
        } else {
          const childResults = await Promise.allSettled(
            children.map((id) => this.executeNode(id, nodeMap, graph, run, visited)),
          );

          if (aggregation === 'merge') {
            // Merge: collect all outputs into one string
            const parts: string[] = [];
            for (const childId of children) {
              const childStep = run.steps.find((s) => s.nodeId === childId);
              const childOutput = run.results.get(childId);
              if (childStep) {
                parts.push(`[${childId}]: ${childStep.output}`);
              } else if (childOutput) {
                parts.push(`[${childId}]: ${String(childOutput)}`);
              }
            }
            output = parts.join('\n');
          } else {
            // "all" (default): store each output, generate summary
            for (const childId of children) {
              const childStep = run.steps.find((s) => s.nodeId === childId);
              if (childStep) {
                run.results.set(childId, childStep.output);
              }
            }
            const statuses = childResults.map((r, i) =>
              r.status === 'fulfilled' ? `${children[i]}: ok` : `${children[i]}: error`,
            );
            output = statuses.join(', ');
          }
        }
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
    this.saveRun(run);

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

  private evaluateCondition(expr: string, previousOutputs: string, run: WorkflowRun): boolean {
    if (!expr || expr === 'true') return true;
    if (expr === 'false') return false;

    const context: ConditionContext = {
      resolve: (path: string) => {
        // steps.<nodeId>.output[.field...]
        if (path.startsWith('steps.')) {
          const parts = path.slice(6).split('.');
          const nodeId = parts[0]!;
          const step = run.steps.find((s) => s.nodeId === nodeId);
          if (!step) throw new Error(`Step not found: ${nodeId}`);

          let value: unknown = step.output;
          // Try JSON parse for structured output
          try { value = JSON.parse(step.output); } catch { /* use raw string */ }

          // Walk remaining path segments
          for (let i = 1; i < parts.length; i++) {
            if (value && typeof value === 'object') {
              value = (value as Record<string, unknown>)[parts[i]!];
            } else {
              return 'undefined';
            }
          }
          return String(value ?? '');
        }

        // results.<key>
        if (path.startsWith('results.')) {
          const key = path.slice(8);
          const val = run.results.get(key);
          return val != null ? String(val) : 'undefined';
        }

        // run.status
        if (path === 'run.status') return run.status;

        throw new Error(`Unknown reference: {{${path}}}`);
      },
    };

    try {
      return evaluateExpr(expr, context);
    } catch {
      // Fallback to simple string match for backward compatibility
      const lower = previousOutputs.toLowerCase();
      return lower.includes(expr.toLowerCase());
    }
  }

  // ── Persistence ────────────────────────────────────────────

  private saveRun(run: WorkflowRun): void {
    if (!this.db) return;
    try {
      const results: Record<string, unknown> = {};
      for (const [k, v] of run.results) { results[k] = v; }
      this.db
        .prepare(
          `INSERT OR REPLACE INTO workflow_runs (run_id, workflow_id, status, current_node_id, steps, results, started_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        )
        .run(
          run.runId,
          run.workflowId,
          run.status,
          run.currentNodeId,
          JSON.stringify(run.steps),
          JSON.stringify(results),
          run.startedAt.toISOString(),
        );
    } catch { /* persistence failure is non-fatal for execution */ }
  }

  private loadRun(runId: string): WorkflowRun | null {
    if (!this.db) return null;
    try {
      const row = this.db
        .prepare('SELECT * FROM workflow_runs WHERE run_id = ?')
        .get(runId) as any;
      if (!row) return null;
      const results = new Map<string, unknown>(Object.entries(JSON.parse(row.results ?? '{}')));
      return {
        runId: row.run_id,
        workflowId: row.workflow_id,
        status: row.status,
        currentNodeId: row.current_node_id,
        results,
        steps: JSON.parse(row.steps ?? '[]'),
        startedAt: new Date(row.started_at),
      };
    } catch {
      return null;
    }
  }

  private listIncompleteRuns(workflowId: string): WorkflowRun[] {
    if (!this.db) return [];
    try {
      const rows = this.db
        .prepare(
          "SELECT * FROM workflow_runs WHERE workflow_id = ? AND status IN ('running', 'awaiting_approval', 'paused') ORDER BY updated_at DESC",
        )
        .all(workflowId) as any[];
      return rows.map((row: any) => {
        const results = new Map<string, unknown>(Object.entries(JSON.parse(row.results ?? '{}')));
        return {
          runId: row.run_id,
          workflowId: row.workflow_id,
          status: row.status,
          currentNodeId: row.current_node_id,
          results,
          steps: JSON.parse(row.steps ?? '[]'),
          startedAt: new Date(row.started_at),
        };
      });
    } catch {
      return [];
    }
  }
}
