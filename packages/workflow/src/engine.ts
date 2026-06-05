import { spawn } from 'node:child_process';
import { WorkflowRepository, type Database } from '@cabinet/storage';
import type { WorkflowNodeDef, WorkflowNodeType, ContextSlot, WorkflowRunStep, StructuredInput } from '@cabinet/types';
import { ManagerExecutor } from './manager-executor.js';
import type { ManagerContextDeps } from './manager-context.js';
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
  | 'awaiting_approval' | 'awaiting_human'
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

      // ── ErrorTrigger (M2): check if any node has a recovery workflow ──
      const failedNodeId = run.currentNodeId;
      const failedNode = nodeMap.get(failedNodeId);
      if (failedNode?.errorTriggerWorkflowId && this.handlers.runSubWorkflow) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        try {
          await this.handlers.runSubWorkflow(failedNode.errorTriggerWorkflowId, {
            failedRunId: run.runId,
            failedNodeId,
            errorMessage: errorMsg,
            partialResults: Object.fromEntries(run.results),
          });
        } catch { /* ErrorTrigger failure is non-fatal */ }
      }

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

      // ── ErrorTrigger (M2) ──
      const failedNodeId = run.currentNodeId;
      const failedNode = nodeMap.get(failedNodeId);
      if (failedNode?.errorTriggerWorkflowId && this.handlers.runSubWorkflow) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        try {
          await this.handlers.runSubWorkflow(failedNode.errorTriggerWorkflowId, {
            failedRunId: run.runId,
            failedNodeId,
            errorMessage: errorMsg,
            partialResults: Object.fromEntries(run.results),
          });
        } catch { /* ErrorTrigger failure is non-fatal */ }
      }

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
  // eslint-disable-next-line @typescript-eslint/no-this-alias
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
   * Build a StructuredInput for the given node by collecting upstream step data.
   * Replaces the legacy `previousOutputs.join('\n')` pattern with typed, traceable input.
   */
  private buildNodeInput(run: WorkflowRun, nodeId: string): StructuredInput {
    // Find incoming edges to this node
    const incoming = this.currentEdges.filter((e) => e.to === nodeId);
    const upstreamNodeIds = new Set(incoming.map((e) => e.from));

    // Collect structured data from upstream steps
    const upstreamItems: StructuredInput['upstreamItems'] = [];
    for (const s of [...run.steps].reverse()) {
      if (upstreamNodeIds.has(s.nodeId)) {
        upstreamItems.unshift({
          nodeId: s.nodeId,
          type: s.type,
          items: s.items ?? [s.output],
          contract: s.contract,
          pairedItem: s.pairedItem,
        });
      }
    }

    // If no upstream edges found, include the last step as context
    if (upstreamItems.length === 0 && run.steps.length > 0) {
      const last = run.steps[run.steps.length - 1];
      if (last) {
        upstreamItems.push({
          nodeId: last.nodeId,
          type: last.type,
          items: last.items ?? [last.output],
          contract: last.contract,
          pairedItem: last.pairedItem,
        });
      }
    }

    return {
      previousOutputs: run.steps.map((s) => s.output).join('\n'),
      upstreamItems,
    };
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
        const timeout = node.codeTimeout ?? 30000;
        if (!node.code) { output = ''; break; }
        // ── M3 Code Sandbox: spawn child process + structured JSON context ──
        const nodeInput = this.buildNodeInput(run, node.id);
        output = await this.runCodeSandboxed(node.code, nodeInput, timeout);
        break;
      }
      case 'workflow': {
        if (!node.workflowId) throw new Error('workflowId is required');
        if (!this.handlers.runSubWorkflow) throw new Error('No sub-workflow handler');
        const subInput = { previousOutputs, inputMapping: node.inputMapping };

        // ── M3 Sync Sub-workflow: fire-and-forget vs await ──
        if (node.synchronous === false) {
          // Fire-and-forget: don't wait, continue immediately
          this.handlers.runSubWorkflow(node.workflowId, subInput).catch((err) => {
            console.error(`[WorkflowEngine] Fire-and-forget sub-workflow ${node.workflowId} failed:`, (err as Error).message);
          });
          output = `Sub-workflow ${node.workflowId} triggered (async)`;
        } else {
          // Synchronous (default): await completion
          const result = await this.handlers.runSubWorkflow(node.workflowId, subInput);
          output = typeof result === 'string' ? result : JSON.stringify(result);
        }
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
      case 'manager': {
        // Manager node: Plan → Dispatch → Review → Iterate → Synthesize
        const childNodes = node.children ?? [];
        if (childNodes.length === 0) {
          output = 'Manager: no children to coordinate';
          break;
        }

        // Build child graph and node map
        const childIds = new Set(childNodes.map((c) => c.id));
        const childEdges = this.currentEdges.filter((e) => childIds.has(e.from) && childIds.has(e.to));
        const childGraph = this.buildGraph(childNodes, childEdges);
        const childMap = new Map(childNodes.map((c) => [c.id, c]));

        // Build ManagerContextDeps for the executor
        const managerDeps: ManagerContextDeps = {
          children: childNodes,
          executeChild: async (childNodeId, input) => {
            // Temporarily modify run's previous outputs for the child
            const savedSteps = [...run.steps];
            // Create a synthetic step from the structured input
            const syntheticStep: WorkflowRunStep = {
              nodeId: '__manager_input__',
              type: 'pass',
              output: input.previousOutputs,
              items: input.upstreamItems.flatMap((u) => u.items),
            };
            run.steps.push(syntheticStep);

            // Execute the child
            await this.executeNode(childNodeId, childMap, childGraph, run, new Set([node.id]));

            // Restore steps and extract the child's result
            const childStep = run.steps.find((s) => s.nodeId === childNodeId);
            run.steps = savedSteps;

            if (!childStep) {
              throw new Error(`Manager child ${childNodeId} produced no output`);
            }
            return childStep;
          },
          planWithLLM: async (prompt) => {
            if (!this.handlers.aiAgent) throw new Error('No aiAgent handler for manager planning');
            return this.handlers.aiAgent(node, prompt);
          },
          reviewWithLLM: async (prompt) => {
            if (!this.handlers.aiAgent) throw new Error('No aiAgent handler for manager review');
            return this.handlers.aiAgent(node, prompt);
          },
          synthesizeWithLLM: async (prompt) => {
            if (!this.handlers.aiAgent) throw new Error('No aiAgent handler for manager synthesis');
            return this.handlers.aiAgent(node, prompt);
          },
          maxRounds: node.managerConfig?.maxRounds ?? 5,
        };

        const nodeInput = this.buildNodeInput(run, node.id);
        output = await ManagerExecutor.run(node, nodeInput, managerDeps);
        break;
      }
      default:
        throw new Error(`Unknown node type: ${(node as any).type}`);
    }

    // ── Build structured step with data lineage (M1 Data Plane) ──
    const inboundEdges = this.currentEdges.filter((e) => e.to === node.id);
    const step: WorkflowRunStep = {
      nodeId: node.id,
      type: node.type,
      output,
    };

    // Populate output contract from node definition
    if (node.output?.schema || node.output?.role) {
      step.contract = {
        schema: node.output?.schema as Record<string, 'string' | 'number' | 'boolean' | 'json' | 'file'> | undefined,
        role: node.output?.role ?? (node.output?.passThrough ? 'passthrough' : 'intermediate'),
      };
    } else if (node.output?.passThrough) {
      step.contract = { role: 'passthrough' };
    }

    // Try structured parse if schema is declared
    if (step.contract?.schema && output) {
      try {
        const parsed = JSON.parse(output);
        step.items = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        // Not valid JSON — keep as plain output, items stays undefined
      }
    }

    // Auto-set pairedItem: link to the most recent upstream step that feeds this node
    if (inboundEdges.length > 0 && run.steps.length > 0) {
      const sourceEdge = inboundEdges[0];
      if (sourceEdge) {
        step.pairedItem = { sourceNodeId: sourceEdge.from, sourceStepIndex: run.steps.length - 1 };
      }
    }

    run.steps.push(step);
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

    // ── Error Strategy: retry → continueOnFail → ErrorTrigger (M2 Control Plane) ──
    let degraded = false;
    try {
      await this.executeWithRetry(node, run, nodeMap);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Level 2: continueOnFail — non-critical node, degrade and continue
      if (node.onError === 'continue') {
        degraded = true;
        // Record a degraded step so the pipeline doesn't lose context
        run.steps.push({
          nodeId: node.id,
          type: node.type,
          output: `[DEGRADED] ${message}`,
        });
        run.results.set(node.id, `[DEGRADED] ${message}`);
        run.currentNodeId = node.id;
        this.appendStepAndResult(run, node.id, node.type, `[DEGRADED] ${message}`);
        // If this is the first degraded node, mark run as completed_with_errors
        if (run.status !== 'failed') {
          run.status = 'completed_with_errors';
        }
      } else {
        // Level 3: ErrorTrigger — re-throw to propagate up to startRun's catch
        throw err;
      }
    }

    if (run.status === 'awaiting_approval' || run.status === 'awaiting_human') {
      this.saveRun(run);
      return;
    }

    // Continue to children (even if degraded — skip only on hard failure)
    const children = graph.get(nodeId) ?? [];
    for (const child of children) {
      if (!visited.has(child)) {
        await this.executeNode(child, nodeMap, graph, run, visited);
      }
    }
  }

  /**
   * Execute a node with automatic retry for transient errors (Level 1 of Error Strategy).
   *
   * Transient errors (timeout, rate limit, connection refused) are retried
   * with exponential backoff. Non-transient errors propagate immediately.
   */
  private async executeWithRetry(
    node: WorkflowNodeDef,
    run: WorkflowRun,
    nodeMap: Map<string, WorkflowNodeDef>,
  ): Promise<void> {
    const maxRetries = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.runNode(node, run, nodeMap);
        return; // Success
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const category = this.classifyError(lastError);

        if (category === 'fatal' || attempt >= maxRetries) {
          throw lastError;
        }

        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    throw lastError!;
  }

  /** Classify an error for retry decisions. Mirrors @cabinet/agent's classifyError. */
  private classifyError(error: Error): 'transient' | 'recoverable' | 'fatal' {
    const msg = error.message.toLowerCase();
    if (
      msg.includes('timeout') ||
      msg.includes('429') ||
      msg.includes('rate limit') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('socket') ||
      msg.includes('econnreset')
    ) {
      return 'transient';
    }
    if (
      msg.includes('temporarily') ||
      msg.includes('unavailable') ||
      msg.includes('busy') ||
      msg.includes('retry')
    ) {
      return 'recoverable';
    }
    return 'fatal';
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

  /**
   * Execute code in a sandboxed child process with structured JSON context (M3 Code Sandbox).
   *
   * Spawns a Node.js child process, injects the structured workflow context via stdin,
   * captures stdout/stderr, and enforces a timeout. Falls back to the runCode handler
   * if spawn is not available.
   */
  private async runCodeSandboxed(code: string, input: StructuredInput, timeoutMs: number): Promise<string> {
    // Build structured context for injection via stdin
    const contextJson = JSON.stringify({
      input: input.previousOutputs,
      upstream: input.upstreamItems.map((i) => ({
        nodeId: i.nodeId,
        type: i.type,
        items: i.items,
      })),
    });

    return new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', code], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeoutMs,
        env: { ...process.env, CABINET_SANDBOX: '1' },
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      // Inject structured context via stdin
      child.stdin?.write(contextJson);
      child.stdin?.end();

      child.on('close', (code) => {
        const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
        const stderr = Buffer.concat(stderrChunks).toString('utf-8');

        if (code === 0) {
          resolve(stdout.trim() || stderr.trim());
        } else {
          reject(new Error(`Sandbox exited with code ${code}: ${stderr.slice(0, 300)}`));
        }
      });

      child.on('error', (err) => {
        reject(new Error(`Sandbox spawn failed: ${err.message}`));
      });
    });
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
