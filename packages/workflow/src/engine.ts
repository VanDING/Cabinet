import { WorkflowRepository, type Database } from '@cabinet/storage';
import type {
  WorkflowNodeDef,
  WorkflowNodeType,
  ContextSlot,
  WorkflowRunStep,
  StructuredInput,
} from '@cabinet/types';
import { evaluateCondition as evaluateExpr } from './condition-evaluator.js';
import {
  buildAdjacencyGraph,
  buildNodeInput,
  resolveVariable,
  resolveValue,
  withTimeout,
} from './engine-helpers.js';
import { runCodeSandboxed } from './code-sandbox.js';
import { executeNodeWithRecovery } from './error-recovery.js';
import { WorkflowPersistence } from './persistence.js';
import { NodeExecutor, type NodeExecutorDeps } from './node-executor.js';

export type { WorkflowNodeType, WorkflowNodeDef };

export interface AgentLoopHandle {
  run(message: string): Promise<string>;
  dispose(): Promise<void>;
  handoff(): Promise<string>;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  condition?: string;
  branch?: 'true' | 'false';
  label?: string;
}

export type WorkflowRunStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'awaiting_approval'
  | 'awaiting_human'
  | 'completed_with_errors';

export interface WorkflowRun {
  runId: string;
  workflowId: string;
  status: WorkflowRunStatus;
  currentNodeId: string;
  results: Map<string, unknown>;
  steps: WorkflowRunStep[];
  startedAt: Date;
  _agentLoop?: { agentId: string; handle: AgentLoopHandle } | null;
}

export interface WorkflowHandlers {
  createAgentLoop?: (
    role: string,
    runId: string,
    opts: {
      persistent?: boolean;
      segmentId?: string;
      systemPrompt?: string;
      model?: string;
      allowedTools?: string[];
    },
  ) => Promise<AgentLoopHandle>;
  skill?: (skillId: string, input: unknown) => Promise<unknown>;
  tool?: (toolId: string, params: Record<string, unknown>) => Promise<unknown>;
  runCode?: (code: string, input: unknown, timeout: number) => Promise<unknown>;
  runSubWorkflow?: (workflowId: string, input: unknown) => Promise<unknown>;
  humanApproval?: (
    node: WorkflowNodeDef,
    run: WorkflowRun,
  ) => Promise<{ decisionId: string; status: 'approved' | 'pending' }>;
  humanTask?: (
    node: WorkflowNodeDef,
    run: WorkflowRun,
  ) => Promise<{ taskId: string; status: 'submitted' }>;
  intentClassify?: (
    node: WorkflowNodeDef,
    input: unknown,
  ) => Promise<{ intent: string; confidence: number }>;
  knowledgeBase?: (
    node: WorkflowNodeDef,
    input: unknown,
  ) => Promise<Array<{ content: string; score: number }>>;
  dispatchToExternalAgent?: (
    agentId: string,
    task: {
      runId: string;
      nodeId: string;
      input: unknown;
      previousOutputs: string[];
      slot: ContextSlot;
    },
  ) => Promise<{
    status: 'completed' | 'failed' | 'awaiting_approval';
    output?: unknown;
    decisionId?: string;
  }>;
  aiAgent?: (node: WorkflowNodeDef, previousOutputs: string) => Promise<string>;
}

export class WorkflowEngine {
  private runs = new Map<string, WorkflowRun>();
  private handlers: WorkflowHandlers = {};
  private currentEdges: WorkflowEdge[] = [];
  private persistence = new WorkflowPersistence();
  private nodeExecutor: NodeExecutor;
  private maxCompletedRuns: number;
  private completedRunIds: string[] = [];

  constructor(maxCompletedRuns = 50) {
    this.maxCompletedRuns = maxCompletedRuns;
    this.nodeExecutor = new NodeExecutor(this.buildNodeExecutorDeps());
  }

  private evictCompletedRun(runId: string, status: WorkflowRunStatus): void {
    if (status === 'completed' || status === 'failed' || status === 'completed_with_errors') {
      this.completedRunIds.push(runId);
      if (this.completedRunIds.length > this.maxCompletedRuns) {
        const oldest = this.completedRunIds.shift()!;
        this.runs.delete(oldest);
      }
    }
  }

  private buildNodeExecutorDeps(): NodeExecutorDeps {
    return {
      handlers: this.handlers,
      currentEdges: this.currentEdges,
      finalizeAgentSegment: (run) => this.finalizeAgentSegment(run),
      appendStepAndResult: (run, nodeId, nodeType, output) =>
        this.persistence.appendStepAndResult(run, nodeId, nodeType, output),
      saveRun: (run) => this.persistence.saveRun(run),
    };
  }

  setHandlers(handlers: WorkflowHandlers): void {
    this.handlers = { ...this.handlers, ...handlers };
    this.nodeExecutor = new NodeExecutor(this.buildNodeExecutorDeps());
  }

  setDb(db: Database): void {
    this.persistence.setDb(db);
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
    this.persistence.saveRun(run);

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    this.currentEdges = edges;

    try {
      const adjGraph = buildAdjacencyGraph(nodes, edges);
      await this.executeNode(entryNodeId, nodeMap, adjGraph, run, new Set());
      await this.finalizeAgentSegment(run);
    } catch (error) {
      await this.finalizeAgentSegment(run);
      run.status = 'failed';
      this.persistence.saveRun(run);
      this.handleErrorTrigger(error, run, nodeMap);
      this.evictCompletedRun(run.runId, run.status);
      return run;
    }

    if (run.status === 'running') {
      run.status = 'completed';
      this.persistence.saveRun(run);
    }
    this.evictCompletedRun(run.runId, run.status);
    return run;
  }

  async continueRun(
    runId: string,
    nodes: WorkflowNodeDef[],
    edges: WorkflowEdge[],
  ): Promise<WorkflowRun> {
    let run = this.runs.get(runId);
    if (!run) {
      const loaded = this.persistence.loadRun(runId);
      if (!loaded) throw new Error(`Run not found: ${runId}`);
      run = loaded;
      this.runs.set(runId, run);
    }
    if (
      run.status !== 'awaiting_approval' &&
      run.status !== 'paused' &&
      run.status !== 'awaiting_human'
    ) {
      throw new Error(`Cannot continue run with status: ${run.status}`);
    }

    run.status = 'running';
    run._agentLoop = null;

    const graph = buildAdjacencyGraph(nodes, edges);
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    this.currentEdges = edges;
    const children = graph.get(run.currentNodeId) ?? [];
    const visited = new Set<string>();

    try {
      for (const child of children) {
        if (!visited.has(child)) await this.executeNode(child, nodeMap, graph, run, visited);
      }
    } catch (error) {
      run.status = 'failed';
      this.persistence.saveRun(run);
      this.handleErrorTrigger(error, run, nodeMap);
      this.evictCompletedRun(run.runId, run.status);
      return run;
    }

    if (run.status === 'running') {
      run.status = 'completed';
      this.persistence.saveRun(run);
    }
    this.evictCompletedRun(run.runId, run.status);
    return run;
  }

  getRun(runId: string): WorkflowRun | null {
    const memRun = this.runs.get(runId);
    if (memRun) return memRun;
    return this.persistence.loadRun(runId);
  }

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
      this.persistence.saveRun(run);
    }
  }

  private async executeNode(
    nodeId: string,
    nodeMap: Map<string, WorkflowNodeDef>,
    graph: Map<string, string[]>,
    run: WorkflowRun,
    visited: Set<string>,
  ): Promise<void> {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (!node) return;

    await executeNodeWithRecovery(
      (n, r, nm) => this.nodeExecutor.runNode(n, r, nm, this.executeNode.bind(this)),
      node,
      run,
      nodeMap,
      (r) => this.persistence.saveRun(r),
      (r, nid, nt, out) => this.persistence.appendStepAndResult(r, nid, nt, out),
    );

    if (run.status === 'awaiting_approval' || run.status === 'awaiting_human') {
      this.persistence.saveRun(run);
      return;
    }

    const children = graph.get(nodeId) ?? [];
    const nextIds =
      node.type === 'ifElse' ? this.resolveIfElseChildren(nodeId, children, run) : children;

    for (const child of nextIds) {
      if (!visited.has(child)) {
        await this.executeNode(child, nodeMap, graph, run, visited);
      }
    }
  }

  private resolveIfElseChildren(nodeId: string, children: string[], run: WorkflowRun): string[] {
    if (children.length === 0) return [];
    const step = run.steps.find((s) => s.nodeId === nodeId);
    const output = step?.output ?? '';
    const branchLabel = output.includes('Condition evaluated: false') ? 'false' : 'true';
    const edge = this.currentEdges.find((e) => e.from === nodeId && e.branch === branchLabel);
    const target = edge?.to ?? children[0]!;
    return [target];
  }

  private handleErrorTrigger(
    error: unknown,
    run: WorkflowRun,
    nodeMap: Map<string, WorkflowNodeDef>,
  ): void {
    const failedNodeId = run.currentNodeId;
    const failedNode = nodeMap.get(failedNodeId);
    if (failedNode?.errorTriggerWorkflowId && this.handlers.runSubWorkflow) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      try {
        this.handlers
          .runSubWorkflow(failedNode.errorTriggerWorkflowId, {
            failedRunId: run.runId,
            failedNodeId,
            errorMessage: errorMsg,
            partialResults: Object.fromEntries(run.results),
          })
          .catch(() => {
            /* ErrorTrigger failure is non-fatal */
          });
      } catch (err) {
        console.warn('[Workflow] handleErrorTrigger failed:', err);
      }
    }
  }

  private evaluateCondition(expr: string, previousOutputs: string, run: WorkflowRun): boolean {
    if (!expr || expr === 'true') return true;
    if (expr === 'false') return false;
    try {
      return evaluateExpr(expr, {
        resolve: (path: string) => resolveValue(path, run),
      });
    } catch {
      return previousOutputs.toLowerCase().includes(expr.toLowerCase());
    }
  }
}
