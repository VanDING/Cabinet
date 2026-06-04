import { WorkflowRepository, type Database } from '@cabinet/storage';
import type { WorkflowNodeDef, WorkflowNodeType, ContextSlot } from '@cabinet/types';
import { StateGraph, Annotation } from '@cabinet/graph';
import { evaluateCondition as evaluateExpr, type ConditionContext } from './condition-evaluator.js';

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
  | 'pending' | 'running' | 'paused' | 'completed' | 'failed'
  | 'awaiting_approval' | 'awaiting_human';

export interface WorkflowRun {
  runId: string;
  workflowId: string;
  status: WorkflowRunStatus;
  currentNodeId: string;
  results: Map<string, unknown>;
  steps: { nodeId: string; type: WorkflowNodeType; output: string }[];
  startedAt: Date;
  _agentLoop?: { agentId: string; handle: AgentLoopHandle } | null;
}

export interface WorkflowHandlers {
  // Agent
  createAgentLoop?: (
    role: string, runId: string,
    opts: { persistent?: boolean; segmentId?: string; systemPrompt?: string; model?: string; allowedTools?: string[] },
  ) => Promise<AgentLoopHandle>;
  // Skill / Tool
  skill?: (skillId: string, input: unknown) => Promise<unknown>;
  tool?: (toolId: string, params: Record<string, unknown>) => Promise<unknown>;
  // Code
  runCode?: (code: string, input: unknown, timeout: number) => Promise<unknown>;
  // Workflow nesting
  runSubWorkflow?: (workflowId: string, input: unknown) => Promise<unknown>;
  // Human
  humanApproval?: (node: WorkflowNodeDef, run: WorkflowRun) => Promise<{ decisionId: string; status: 'approved' | 'pending' }>;
  humanTask?: (node: WorkflowNodeDef, run: WorkflowRun) => Promise<{ taskId: string; status: 'submitted' }>;
  // AI
  intentClassify?: (node: WorkflowNodeDef, input: unknown) => Promise<{ intent: string; confidence: number }>;
  knowledgeBase?: (node: WorkflowNodeDef, input: unknown) => Promise<Array<{ content: string; score: number }>>;

  /** Dispatch a task to an external agent (A2A or CLI). */
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

  /** @deprecated Legacy fallback */
  aiAgent?: (node: WorkflowNodeDef, previousOutputs: string) => Promise<string>;
}

// ── Slot Fork / Merge ───────────────────────────────────────────

function forkSlot(parentSlot: ContextSlot): ContextSlot {
  return {
    ...parentSlot,
    discoveries: [...parentSlot.discoveries],
    previous_outputs: [...parentSlot.previous_outputs],
  };
}

function mergeSlots(main: ContextSlot, forks: ContextSlot[]): ContextSlot {
  const allDiscoveries = [...main.discoveries, ...forks.flatMap((f) => f.discoveries)];
  const allOutputs = [...main.previous_outputs, ...forks.flatMap((f) => f.previous_outputs)];
  return {
    ...main,
    discoveries: allDiscoveries,
    previous_outputs: allOutputs,
  };
}

export class WorkflowEngine {
  private runs = new Map<string, WorkflowRun>();
  private handlers: WorkflowHandlers = {};
  private repo: WorkflowRepository | null = null;
  private currentEdges: WorkflowEdge[] = [];

  setHandlers(handlers: WorkflowHandlers): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  setDb(db: Database): void {
    this.repo = new WorkflowRepository(db);
  }

  async startRun(
    workflowId: string, nodes: WorkflowNodeDef[], edges: WorkflowEdge[], entryNodeId: string,
  ): Promise<WorkflowRun> {
    const runId = `run_${Date.now()}`;
    const run: WorkflowRun = {
      runId, workflowId, status: 'running', currentNodeId: entryNodeId,
      results: new Map(), steps: [], startedAt: new Date(),
    };
    this.runs.set(runId, run);
    this.saveRun(run);

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    this.currentEdges = edges;

    try {
      const sg = this.buildStateGraph(nodes, edges, entryNodeId, run, nodeMap);
      const compiled = sg.compile({ entry: entryNodeId });
      if (compiled.ok) {
        await compiled.graph!.invoke({});
      } else {
        // Fallback to legacy execution on compile failure
        const adjGraph = this.buildGraph(nodes, edges);
        await this.executeNode(entryNodeId, nodeMap, adjGraph, run, new Set());
      }
      await this.finalizeAgentSegment(run);
    } catch (error) {
      await this.finalizeAgentSegment(run);
      run.status = 'failed';
      this.saveRun(run);
      return run;
    }

    if (run.status === 'running') { run.status = 'completed'; this.saveRun(run); }
    return run;
  }

  async continueRun(
    runId: string, nodes: WorkflowNodeDef[], edges: WorkflowEdge[],
  ): Promise<WorkflowRun> {
    let run = this.runs.get(runId);
    if (!run) {
      const loaded = this.loadRun(runId);
      if (!loaded) throw new Error(`Run not found: ${runId}`);
      run = loaded;
      this.runs.set(runId, run);
    }
    if (run.status !== 'awaiting_approval' && run.status !== 'paused' && run.status !== 'awaiting_human') {
      throw new Error(`Cannot continue run with status: ${run.status}`);
    }

    run.status = 'running';
    run._agentLoop = null;

    const graph = this.buildGraph(nodes, edges);
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
      this.saveRun(run);
      return run;
    }

    if (run.status === 'running') { run.status = 'completed'; this.saveRun(run); }
    return run;
  }

  getRun(runId: string): WorkflowRun | null {
    const memRun = this.runs.get(runId);
    if (memRun) return memRun;
    return this.loadRun(runId);
  }

  private async finalizeAgentSegment(run: WorkflowRun): Promise<void> {
    if (run._agentLoop) {
      try {
        const handoffDoc = await run._agentLoop.handle.handoff();
        run.results.set(`_handoff:${run._agentLoop.agentId}`, handoffDoc);
        await run._agentLoop.handle.dispose();
      } catch { /* cleanup failure is non-fatal */ }
      run._agentLoop = null;
      this.saveRun(run);
    }
  }

  private buildGraph(nodes: WorkflowNodeDef[], edges: WorkflowEdge[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    for (const n of nodes) graph.set(n.id, []);
    for (const e of edges) {
      if (!graph.has(e.from)) graph.set(e.from, []);
      graph.get(e.from)!.push(e.to);
    }
    return graph;
  }

  private buildStateGraph(
    nodes: WorkflowNodeDef[],
    edges: WorkflowEdge[],
    _entryNodeId: string,
    run: WorkflowRun,
    nodeMap: Map<string, WorkflowNodeDef>,
  ): StateGraph<Record<string, Annotation<any>>> {
    const schema: Record<string, Annotation<any>> = {};
    for (const node of nodes) {
      schema[node.id] = Annotation<unknown>({
        reducer: (_a, b) => b,
        default: () => null,
      });
    }

    const sg = new StateGraph(schema);
    const self = this;

    for (const node of nodes) {
      sg.addNode(node.id, async () => {
        await self.runNode(node, run, nodeMap);
        return {};
      });
    }

    // Add edges, replacing ifElse static edges with conditional edges
    const ifElseNodes = new Set(nodes.filter((n) => n.type === 'ifElse').map((n) => n.id));

    for (const edge of edges) {
      if (ifElseNodes.has(edge.from)) continue; // handled below
      sg.addEdge(edge.from, edge.to);
    }

    // Add conditional edges for ifElse nodes
    for (const nodeId of ifElseNodes) {
      const children = edges.filter((e) => e.from === nodeId).map((e) => e.to);
      const trueChild = children[0];
      const falseChild = children.length >= 2 ? children[1] : undefined;

      const targets: Record<string, string> = {};
      if (trueChild) targets['true'] = trueChild;
      if (falseChild) targets['false'] = falseChild;
      targets['__default__'] = trueChild ?? falseChild ?? '__END__';

      sg.addConditionalEdges(nodeId, () => {
        const matchingSteps = run.steps.filter((s: { nodeId: string }) => s.nodeId === nodeId);
        const step = matchingSteps[matchingSteps.length - 1];
        if (!step) return '__default__';
        const output = step.output;
        if (output.includes('Matched branch:')) {
          // Use the first child for "matched" condition
          return 'true';
        }
        if (output.includes('Condition evaluated: true')) return 'true';
        if (output.includes('Condition evaluated: false')) return 'false';
        return '__default__';
      }, targets);
    }

    return sg;
  }

  /**
   * Execute a single node's logic and return output.
   * Does NOT recurse into children — graph edges handle traversal.
   */
  private async runNode(
    node: WorkflowNodeDef, run: WorkflowRun, nodeMap: Map<string, WorkflowNodeDef>,
  ): Promise<string> {
    const previousOutputs = run.steps.map((s) => s.output).join('\n');
    let output = '';

    switch (node.type) {
      case 'start':
        output = 'Workflow started';
        break;
      case 'end':
        output = 'Workflow ended';
        break;
      case 'agentGroup': {
        const role = node.role ?? 'secretary';
        await this.finalizeAgentSegment(run);
        if (!this.handlers.createAgentLoop) { output = 'No agent handler registered'; break; }
        const handle = await this.handlers.createAgentLoop(role, run.runId, {
          persistent: node.persistent ?? true,
          systemPrompt: node.systemPrompt,
          model: node.model,
          allowedTools: node.allowedTools,
        });
        run._agentLoop = { agentId: role, handle };
        const childIds = new Set((node.children ?? []).map((c) => c.id));
        const childEdges = this.currentEdges.filter((e) => childIds.has(e.from) && childIds.has(e.to));
        const childGraph = this.buildGraph(node.children ?? [], childEdges);
        const childMap = new Map((node.children ?? []).map((c) => [c.id, c]));
        const entryChild = node.children?.[0]?.id;
        if (entryChild) {
          await this.executeNode(entryChild, childMap, childGraph, run, new Set());
        }
        await this.finalizeAgentSegment(run);
        const handoffKey = `_handoff:${role}`;
        const handoff = run.results.get(handoffKey);
        output = handoff ? String(handoff) : `Agent group ${role} completed`;
        break;
      }
      case 'llm': {
        if (run._agentLoop) {
          const prompt = node.prompt ?? node.title ?? 'Process this step';
          const timeoutMs = node.codeTimeout ?? 120_000;
          output = await this.withTimeout(run._agentLoop.handle.run(prompt), timeoutMs, `LLM ${node.id}`);
        } else if (this.handlers.aiAgent) {
          const timeoutMs = node.codeTimeout ?? 120_000;
          output = await this.withTimeout(this.handlers.aiAgent(node, previousOutputs), timeoutMs, `LLM ${node.id}`);
        } else { throw new Error('LLM node requires an AgentGroup or aiAgent handler'); }
        break;
      }
      case 'skill': {
        if (!this.handlers.skill) throw new Error('No skill handler registered');
        const result = await this.handlers.skill(node.skillId ?? node.id, {
          nodeId: node.id, previousOutputs, inputMapping: node.inputMapping ?? {},
        });
        output = typeof result === 'string' ? result : JSON.stringify(result);
        break;
      }
      case 'tool': {
        if (!this.handlers.tool) throw new Error('No tool handler registered');
        const params = { ...(node.inputMapping ?? {}) };
        for (const [k, v] of Object.entries(params)) {
          if (typeof v === 'string' && v.startsWith('{{')) {
            params[k] = this.resolveVariable(v, run);
          }
        }
        const result = await this.handlers.tool(node.toolId ?? node.id, params);
        output = typeof result === 'string' ? result : JSON.stringify(result);
        break;
      }
      case 'code': {
        if (!this.handlers.runCode) throw new Error('No code handler registered');
        const timeout = node.codeTimeout ?? 5000;
        const result = await this.handlers.runCode(node.code ?? '', previousOutputs, timeout);
        output = typeof result === 'string' ? result : JSON.stringify(result);
        break;
      }
      case 'workflow': {
        if (!this.handlers.runSubWorkflow) throw new Error('No sub-workflow handler');
        if (!node.workflowId) throw new Error('workflowId is required');
        const result = await this.handlers.runSubWorkflow(node.workflowId, { previousOutputs, inputMapping: node.inputMapping });
        output = typeof result === 'string' ? result : JSON.stringify(result);
        break;
      }
      case 'ifElse': {
        const branches = node.branches ?? [];
        let matched = false;
        if (branches.length > 0) {
          for (const branch of branches) {
            const allTrue = branch.conditions.every((c) => {
              const val = this.resolveValue(c.field, run);
              return this.evaluateOp(val, c.operator, c.value);
            });
            if (allTrue) { output = `Matched branch: ${branch.label}`; matched = true; break; }
          }
        }
        if (!matched) {
          const conditionExpr = node.loopCondition ?? 'true';
          const isTrue = this.evaluateCondition(conditionExpr, previousOutputs, run);
          output = `Condition evaluated: ${isTrue}`;
        }
        break;
      }
      case 'loop': {
        const maxIter = node.loopMaxIterations ?? 1000;
        const exitIds: string[] = [];
        const childIds = new Set((node.children ?? []).map((c) => c.id));
        for (const edge of this.currentEdges) {
          if (childIds.has(edge.from) && !childIds.has(edge.to)) exitIds.push(edge.to);
        }
        const results: unknown[] = [];
        const childEdges = this.currentEdges.filter((e) => childIds.has(e.from) && childIds.has(e.to));
        const childGraph = this.buildGraph(node.children ?? [], childEdges);
        const childMap = new Map((node.children ?? []).map((c) => [c.id, c]));
        for (let i = 0; i < maxIter; i++) {
          if (node.loopType === 'count' && i >= (node.loopCount ?? 1)) break;
          if (node.loopType === 'condition' && node.loopCondition) {
            const condResult = this.evaluateCondition(node.loopCondition, previousOutputs, run);
            if (!condResult) break;
          }
          const entryChild = node.children?.[0]?.id;
          if (entryChild) {
            await this.executeNode(entryChild, childMap, childGraph, run, new Set());
          }
          const lastStep = run.steps[run.steps.length - 1];
          if (lastStep) results.push({ iteration: i, result: lastStep.output });
        }
        output = node.loopOutputMode === 'merge'
          ? results.map((r: any) => r.result).join('\n')
          : JSON.stringify(results);
        for (const exitId of exitIds) {
          await this.executeNode(exitId, nodeMap, this.buildGraph([], []), run, new Set());
        }
        break;
      }
      case 'parallel': {
        const childIds = new Set((node.children ?? []).map((c) => c.id));
        const childEdges = this.currentEdges.filter((e) => childIds.has(e.from) && childIds.has(e.to));
        const childGraph = this.buildGraph(node.children ?? [], childEdges);
        const childMap = new Map((node.children ?? []).map((c) => [c.id, c]));
        const entryChildren = node.children?.map((c) => c.id) ?? [];
        const childResults = await Promise.allSettled(
          entryChildren.map((id) => this.executeNode(id, childMap, childGraph, run, new Set())),
        );
        const parts: string[] = [];
        for (const childId of entryChildren) {
          const childStep = run.steps.find((s) => s.nodeId === childId);
          if (childStep) parts.push(`[${childId}]: ${childStep.output}`);
        }
        output = parts.join('\n');
        if (node.failStrategy === 'failAll') {
          if (childResults.some((r) => r.status === 'rejected')) throw new Error('Parallel branch failed');
        }
        break;
      }
      case 'merge': {
        const strategy = node.mergeStrategy ?? 'object';
        const merged: Record<string, unknown> = {};
        for (const [k, v] of run.results) {
          if (k !== node.id) merged[k] = v;
        }
        output = strategy === 'array' ? JSON.stringify(Object.values(merged)) : JSON.stringify(merged);
        break;
      }
      case 'pass':
        output = '';
        break;
      case 'intentClassify': {
        if (!this.handlers.intentClassify) throw new Error('No intent classify handler');
        const result = await this.handlers.intentClassify(node, previousOutputs);
        output = JSON.stringify(result);
        break;
      }
      case 'knowledgeBase': {
        if (!this.handlers.knowledgeBase) throw new Error('No knowledge base handler');
        const chunks = await this.handlers.knowledgeBase(node, previousOutputs);
        output = JSON.stringify({ query: node.queryTemplate ?? previousOutputs, chunks });
        break;
      }
      case 'approval': {
        if (!this.handlers.humanApproval) throw new Error('No humanApproval handler');
        const decision = await this.handlers.humanApproval(node, run);
        if (decision.status === 'pending') {
          output = `Approval pending: decision ${decision.decisionId}`;
          run.status = 'awaiting_approval';
        } else { output = 'Approval granted'; }
        break;
      }
      case 'human': {
        if (this.handlers.humanTask) {
          const task = await this.handlers.humanTask(node, run);
          output = `Human task submitted: ${task.taskId}`;
          run.status = 'awaiting_human';
        } else if (this.handlers.humanApproval) {
          const decision = await this.handlers.humanApproval(node, run);
          output = `Human task: decision ${decision.decisionId}`;
          if (decision.status === 'pending') run.status = 'awaiting_approval';
        } else { throw new Error('No human handler registered'); }
        break;
      }
      case 'externalAgent': {
        if (!this.handlers.dispatchToExternalAgent) {
          throw new Error('No external agent dispatch handler registered');
        }
        const agentId = node.agentId ?? node.role ?? node.id;
        const allOutputs = run.steps.map((s) => s.output);
        const slot: ContextSlot = {
          project: { name: 'workflow', goals: [] },
          memories: [],
          preferences: {},
          files: [],
          discoveries: [],
          previous_outputs: allOutputs,
          security: { level: 'L1', tier: 'auto', maxRetries: 2 },
        };
        const result = await this.handlers.dispatchToExternalAgent(agentId, {
          runId: run.runId,
          nodeId: node.id,
          input: previousOutputs,
          previousOutputs: allOutputs,
          slot,
        });
        if (result.status === 'awaiting_approval') {
          run.status = 'awaiting_approval';
          output = `External agent ${agentId} awaiting approval: ${result.decisionId ?? ''}`;
        } else if (result.status === 'failed') {
          output = `External agent ${agentId} failed`;
          throw new Error(`External agent ${agentId} failed`);
        } else {
          output = typeof result.output === 'string' ? result.output : JSON.stringify(result.output ?? {});
        }
        break;
      }
      default:
        throw new Error(`Unknown node type: ${(node as any).type}`);
    }

    run.steps.push({ nodeId: node.id, type: node.type, output });
    run.results.set(node.id, output);
    run.currentNodeId = node.id;
    this.appendStepAndResult(run, node.id, node.type, output);
    return output;
  }

  private async executeNode(
    nodeId: string, nodeMap: Map<string, WorkflowNodeDef>,
    graph: Map<string, string[]>, run: WorkflowRun, visited: Set<string>,
  ): Promise<void> {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (!node) return;

    await this.runNode(node, run, nodeMap);

    if (run.status === 'awaiting_approval' || run.status === 'awaiting_human') {
      this.saveRun(run);
      return;
    }

    // Continue to children
    const children = graph.get(nodeId) ?? [];
    for (const child of children) {
      if (!visited.has(child)) {
        await this.executeNode(child, nodeMap, graph, run, visited);
      }
    }
  }

  // ── Helpers ──

  private findChildForBranch(nodeId: string, branchLabel: string, graph: Map<string, string[]>): string | undefined {
    const children = graph.get(nodeId) ?? [];
    for (const childId of children) {
      const edge = this.currentEdges.find((e) => e.from === nodeId && e.to === childId);
      if (!edge || edge.label === branchLabel) return childId;
    }
    return children[0];
  }

  private resolveVariable(template: string, run: WorkflowRun): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, path: string) => {
      const parts = path.split('.');
      let val: unknown = run.results.get(parts[0]!);
      for (let i = 1; i < parts.length; i++) {
        if (val && typeof val === 'object') {
          val = (val as Record<string, unknown>)[parts[i]!];
        } else return '';
      }
      return val != null ? String(val) : '';
    });
  }

  private resolveValue(field: string, run: WorkflowRun): string {
    if (field.startsWith('{{') && field.endsWith('}}')) {
      return this.resolveVariable(field, run);
    }
    // Try steps.<id>.output.field
    const parts = field.split('.');
    let val: unknown = null;
    if (parts[0] === 'steps' && parts.length >= 3) {
      const step = run.steps.find((s) => s.nodeId === parts[1]);
      if (step) {
        try { val = JSON.parse(step.output); } catch { val = step.output; }
        for (let i = 2; i < parts.length; i++) {
          if (val && typeof val === 'object') val = (val as any)[parts[i]!];
          else break;
        }
      }
    }
    return val != null ? String(val) : field;
  }

  private evaluateOp(val: string, op: string, expected: string): boolean {
    switch (op) {
      case '==': return val === expected;
      case '!=': return val !== expected;
      case '>': return parseFloat(val) > parseFloat(expected);
      case '<': return parseFloat(val) < parseFloat(expected);
      case '>=': return parseFloat(val) >= parseFloat(expected);
      case '<=': return parseFloat(val) <= parseFloat(expected);
      case 'contains': return val.includes(expected);
      case 'startsWith': return val.startsWith(expected);
      case 'endsWith': return val.endsWith(expected);
      case 'matches': return new RegExp(expected).test(val);
      default: return val === expected;
    }
  }

  private evaluateCondition(expr: string, previousOutputs: string, run: WorkflowRun): boolean {
    if (!expr || expr === 'true') return true;
    if (expr === 'false') return false;
    try {
      return evaluateExpr(expr, {
        resolve: (path: string) => this.resolveValue(path, run),
      });
    } catch {
      return previousOutputs.toLowerCase().includes(expr.toLowerCase());
    }
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
      ),
    ]);
  }

  // ── Persistence ──

  private appendStepAndResult(run: WorkflowRun, nodeId: string, nodeType: string, output: string): void {
    if (!this.repo) return;
    try {
      this.repo.appendStep(run.runId, nodeId, nodeType, output);
      this.repo.appendResult(run.runId, nodeId, output);
    } catch (err) { console.error('[WorkflowEngine] Failed to persist step:', (err as Error).message); }
  }

  private saveRun(run: WorkflowRun): void {
    if (!this.repo) return;
    try {
      const results: Record<string, unknown> = {};
      for (const [k, v] of run.results) results[k] = v;
      this.repo.saveRun({
        run_id: run.runId, workflow_id: run.workflowId, status: run.status,
        current_node_id: run.currentNodeId,
        steps: JSON.stringify(run.steps), results: JSON.stringify(results),
        started_at: run.startedAt.toISOString(), updated_at: new Date().toISOString(),
      });
    } catch (err) { console.error('[WorkflowEngine] Failed to persist run:', (err as Error).message); }
  }

  private loadRun(runId: string): WorkflowRun | null {
    if (!this.repo) return null;
    try {
      const row = this.repo.findRunById(runId);
      if (!row) return null;
      const results = new Map<string, unknown>(Object.entries(JSON.parse(row.results ?? '{}')));
      const incSteps = this.repo.findStepsByRunId(runId);
      const incResults = this.repo.findResultsByRunId(runId);
      const steps = incSteps.length > 0
        ? incSteps.map((s) => ({ nodeId: s.nodeId, type: s.type as WorkflowNodeType, output: s.output }))
        : JSON.parse(row.steps ?? '[]');
      for (const [k, v] of Object.entries(incResults)) results.set(k, v);
      return {
        runId: row.run_id, workflowId: row.workflow_id,
        status: row.status as WorkflowRunStatus, currentNodeId: row.current_node_id ?? '',
        results, steps, startedAt: new Date(row.started_at),
      };
    } catch { return null; }
  }
}
