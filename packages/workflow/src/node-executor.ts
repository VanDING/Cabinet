import type { WorkflowNodeDef, StructuredInput } from '@cabinet/types';
import type {
  WorkflowRun, WorkflowHandlers, WorkflowEdge,
  AgentLoopHandle,
} from './engine.js';
import { buildAdjacencyGraph, buildNodeInput, resolveVariable, withTimeout } from './engine-helpers.js';
import { runCodeSandboxed } from './code-sandbox.js';
import type { ManagerContextDeps } from './manager-context.js';
import { ManagerExecutor } from './manager-executor.js';

export interface NodeExecutorDeps {
  handlers: WorkflowHandlers;
  currentEdges: WorkflowEdge[];
  finalizeAgentSegment: (run: WorkflowRun) => Promise<void>;
  appendStepAndResult: (run: WorkflowRun, nodeId: string, nodeType: string, output: string) => void;
  saveRun: (run: WorkflowRun) => void;
}

export class NodeExecutor {
  constructor(private deps: NodeExecutorDeps) {}

  async runNode(
    node: WorkflowNodeDef,
    run: WorkflowRun,
    nodeMap: Map<string, WorkflowNodeDef>,
    executeNode: (nodeId: string, nodeMap: Map<string, WorkflowNodeDef>, graph: Map<string, string[]>, run: WorkflowRun, visited: Set<string>) => Promise<void>,
  ): Promise<string> {
    const previousOutputs = run.steps.map((s) => s.output).join('\n');
    let output: string;

    switch (node.type) {
      case 'start': output = 'Workflow started'; break;
      case 'end': output = 'Workflow ended'; break;
      case 'agentGroup':
        output = await this.execAgentGroup(node, run, nodeMap, executeNode); break;
      case 'llm':
        output = await this.execLlm(node, run, previousOutputs); break;
      case 'skill':
        output = await this.execSkill(node, previousOutputs); break;
      case 'tool':
        output = await this.execTool(node, run); break;
      case 'code':
        output = await this.execCode(node, run); break;
      case 'workflow':
        output = await this.execWorkflow(node, previousOutputs); break;
      case 'ifElse':
        output = await this.execIfElse(node, run, previousOutputs); break;
      case 'loop':
        output = await this.execLoop(node, run, nodeMap, executeNode); break;
      case 'parallel':
        output = await this.execParallel(node, run, nodeMap, executeNode); break;
      case 'knowledgeBase':
        output = await this.execKnowledgeBase(node, previousOutputs); break;
      case 'approval':
        output = await this.execApproval(node, run); break;
      case 'human':
        output = await this.execHuman(node, run); break;
      case 'externalAgent':
        output = await this.execExternalAgent(node, run, previousOutputs); break;
      case 'manager':
        output = await this.execManager(node, run, nodeMap, executeNode); break;
      default:
        throw new Error(`Unknown node type: ${(node as any).type}`);
    }

    // ── Build structured step with data lineage (M1 Data Plane) ──
    const inboundEdges = this.deps.currentEdges.filter((e) => e.to === node.id);
    const step: import('@cabinet/types').WorkflowRunStep = {
      nodeId: node.id,
      type: node.type,
      output,
    };

    if (node.output?.schema || node.output?.role) {
      step.contract = {
        schema: node.output?.schema as Record<string, 'string' | 'number' | 'boolean' | 'json' | 'file'> | undefined,
        role: node.output?.role ?? (node.output?.passThrough ? 'passthrough' : 'intermediate'),
      };
    } else if (node.output?.passThrough) {
      step.contract = { role: 'passthrough' };
    }

    if (step.contract?.schema && output) {
      try {
        const parsed = JSON.parse(output);
        step.items = Array.isArray(parsed) ? parsed : [parsed];
      } catch { /* not valid JSON */ }
    }

    if (inboundEdges.length > 0 && run.steps.length > 0) {
      const sourceEdge = inboundEdges[0];
      if (sourceEdge) {
        step.pairedItem = { sourceNodeId: sourceEdge.from, sourceStepIndex: run.steps.length - 1 };
      }
    }

    run.steps.push(step);
    run.results.set(node.id, output);
    run.currentNodeId = node.id;
    this.deps.appendStepAndResult(run, node.id, node.type, output);
    return output;
  }

  private async execAgentGroup(
    node: WorkflowNodeDef, run: WorkflowRun,
    nodeMap: Map<string, WorkflowNodeDef>,
    executeNode: (nodeId: string, nodeMap: Map<string, WorkflowNodeDef>, graph: Map<string, string[]>, run: WorkflowRun, visited: Set<string>) => Promise<void>,
  ): Promise<string> {
    const role = node.role ?? 'secretary';
    await this.deps.finalizeAgentSegment(run);
    if (!this.deps.handlers.createAgentLoop) { return 'No agent handler registered'; }
    const handle = await this.deps.handlers.createAgentLoop(role, run.runId, {
      persistent: node.persistent ?? true,
      systemPrompt: node.systemPrompt,
      model: node.model,
      allowedTools: node.allowedTools,
    });
    run._agentLoop = { agentId: role, handle };
    const childIds = new Set((node.children ?? []).map((c) => c.id));
    const childEdges = this.deps.currentEdges.filter((e) => childIds.has(e.from) && childIds.has(e.to));
    const childGraph = buildAdjacencyGraph(node.children ?? [], childEdges);
    const childMap = new Map((node.children ?? []).map((c) => [c.id, c]));
    const entryChild = node.children?.[0]?.id;
    if (entryChild) {
      await executeNode(entryChild, childMap, childGraph, run, new Set());
    }
    await this.deps.finalizeAgentSegment(run);
    const handoffKey = `_handoff:${role}`;
    const handoff = run.results.get(handoffKey);
    return handoff ? String(handoff) : `Agent group ${role} completed`;
  }

  private async execLlm(node: WorkflowNodeDef, run: WorkflowRun, previousOutputs: string): Promise<string> {
    if (run._agentLoop) {
      const prompt = node.prompt ?? node.title ?? 'Process this step';
      const timeoutMs = node.codeTimeout ?? 120_000;
      return await withTimeout(run._agentLoop.handle.run(prompt), timeoutMs, `LLM ${node.id}`);
    } else if (this.deps.handlers.aiAgent) {
      const timeoutMs = node.codeTimeout ?? 120_000;
      return await withTimeout(this.deps.handlers.aiAgent(node, previousOutputs), timeoutMs, `LLM ${node.id}`);
    }
    throw new Error('LLM node requires an AgentGroup or aiAgent handler');
  }

  private async execSkill(node: WorkflowNodeDef, previousOutputs: string): Promise<string> {
    if (!this.deps.handlers.skill) throw new Error('No skill handler registered');
    const result = await this.deps.handlers.skill(node.skillId ?? node.id, {
      nodeId: node.id, previousOutputs, inputMapping: node.inputMapping ?? {},
    });
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  private async execTool(node: WorkflowNodeDef, run: WorkflowRun): Promise<string> {
    if (!this.deps.handlers.tool) throw new Error('No tool handler registered');
    const params: Record<string, unknown> = { ...(node.inputMapping ?? {}) };
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === 'string' && v.startsWith('{{')) {
        params[k] = resolveVariable(v, run);
      }
    }
    const result = await this.deps.handlers.tool(node.toolId ?? node.id, params);
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  private async execCode(node: WorkflowNodeDef, run: WorkflowRun): Promise<string> {
    const timeout = node.codeTimeout ?? 30000;
    if (!node.code) return '';
    const nodeInput = buildNodeInput(run, node.id, this.deps.currentEdges);
    return await runCodeSandboxed(node.code, nodeInput, timeout);
  }

  private async execWorkflow(node: WorkflowNodeDef, previousOutputs: string): Promise<string> {
    if (!node.workflowId) throw new Error('workflowId is required');
    if (!this.deps.handlers.runSubWorkflow) throw new Error('No sub-workflow handler');
    const subInput = { previousOutputs, inputMapping: node.inputMapping };
    if (node.synchronous === false) {
      this.deps.handlers.runSubWorkflow(node.workflowId, subInput).catch((err) => {
        console.error(`[WorkflowEngine] Fire-and-forget sub-workflow ${node.workflowId} failed:`, (err as Error).message);
      });
      return `Sub-workflow ${node.workflowId} triggered (async)`;
    }
    const result = await this.deps.handlers.runSubWorkflow(node.workflowId, subInput);
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  private async execIfElse(node: WorkflowNodeDef, run: WorkflowRun, previousOutputs: string): Promise<string> {
    const branches = node.branches ?? [];
    let matched = false;
    if (branches.length > 0) {
      for (const branch of branches) {
        const allTrue = branch.conditions.every((c) => {
          const val = resolveVariable(c.field, run);
          // Use condition-evaluator compare logic inline for simple ops
          return this.compareOp(val, c.operator, c.value);
        });
        if (allTrue) { matched = true; break; }
      }
    }
    if (matched) return `Matched branch`;
    const conditionExpr = node.loopCondition ?? 'true';
    const isTrue = await this.evaluateCondition(conditionExpr, previousOutputs, run);
    return `Condition evaluated: ${isTrue}`;
  }

  private async execLoop(
    node: WorkflowNodeDef, run: WorkflowRun,
    nodeMap: Map<string, WorkflowNodeDef>,
    executeNode: (nodeId: string, nodeMap: Map<string, WorkflowNodeDef>, graph: Map<string, string[]>, run: WorkflowRun, visited: Set<string>) => Promise<void>,
  ): Promise<string> {
    const maxIter = node.loopMaxIterations ?? 1000;
    const exitIds: string[] = [];
    const childIds = new Set((node.children ?? []).map((c) => c.id));
    for (const edge of this.deps.currentEdges) {
      if (childIds.has(edge.from) && !childIds.has(edge.to)) exitIds.push(edge.to);
    }
    const results: unknown[] = [];
    const childEdges = this.deps.currentEdges.filter((e) => childIds.has(e.from) && childIds.has(e.to));
    const childGraph = buildAdjacencyGraph(node.children ?? [], childEdges);
    const childMap = new Map((node.children ?? []).map((c) => [c.id, c]));
    for (let i = 0; i < maxIter; i++) {
      if (node.loopType === 'count' && i >= (node.loopCount ?? 1)) break;
      if (node.loopType === 'condition' && node.loopCondition) {
        const condResult = await this.evaluateCondition(node.loopCondition, run.steps.map((s) => s.output).join('\n'), run);
        if (!condResult) break;
      }
      const entryChild = node.children?.[0]?.id;
      if (entryChild) {
        await executeNode(entryChild, childMap, childGraph, run, new Set());
      }
      const lastStep = run.steps[run.steps.length - 1];
      if (lastStep) results.push({ iteration: i, result: lastStep.output });
    }
    const output = node.loopOutputMode === 'merge'
      ? results.map((r: any) => r.result).join('\n')
      : JSON.stringify(results);
    for (const exitId of exitIds) {
      await executeNode(exitId, nodeMap, buildAdjacencyGraph([], []), run, new Set());
    }
    return output;
  }

  private async execParallel(
    node: WorkflowNodeDef, run: WorkflowRun,
    nodeMap: Map<string, WorkflowNodeDef>,
    executeNode: (nodeId: string, nodeMap: Map<string, WorkflowNodeDef>, graph: Map<string, string[]>, run: WorkflowRun, visited: Set<string>) => Promise<void>,
  ): Promise<string> {
    const childNodes = node.children ?? [];
    const childIds = new Set(childNodes.map((c) => c.id));
    const childEdges = this.deps.currentEdges.filter((e) => childIds.has(e.from) && childIds.has(e.to));
    const childGraph = buildAdjacencyGraph(childNodes, childEdges);
    const childMap = new Map(childNodes.map((c) => [c.id, c]));

    const promises = childNodes.map(async (child) => {
      const slot = forkSlot({
        project: { name: 'parallel', goals: [] },
        memories: [], preferences: {}, files: [],
        discoveries: [],
        previous_outputs: run.steps.map((s) => s.output),
        security: { level: 'L1', tier: 'auto', maxRetries: 2 },
      });
      const forkRun: WorkflowRun = {
        ...run,
        results: new Map(run.results),
        steps: [...run.steps],
        currentNodeId: child.id,
      };
      forkRun.results.set('discoveries', slot.discoveries);

      await executeNode(child.id, childMap, childGraph, forkRun, new Set());
      const childStep = forkRun.steps.find((s) => s.nodeId === child.id);
      return childStep ? { nodeId: child.id, output: childStep.output } : { nodeId: child.id, output: '' };
    });

    const childResults = await Promise.all(promises);

    const mergeStrategy = node.mergeStrategy ?? 'object';
    if (mergeStrategy === 'object') {
      const merged: Record<string, unknown> = {};
      for (const r of childResults) merged[r.nodeId] = r.output;
      return JSON.stringify(merged);
    }
    if (mergeStrategy === 'array') {
      return JSON.stringify(childResults.map((r) => r.output));
    }
    if (mergeStrategy === 'concat') {
      return childResults.map((r) => r.output).join('\n');
    }
    return childResults.find((r) => r.output)?.output ?? '';
  }

  private async execKnowledgeBase(node: WorkflowNodeDef, previousOutputs: string): Promise<string> {
    if (!this.deps.handlers.knowledgeBase) throw new Error('No knowledge base handler registered');
    const result = await this.deps.handlers.knowledgeBase(node, previousOutputs);
    return JSON.stringify(result);
  }

  private async execApproval(node: WorkflowNodeDef, run: WorkflowRun): Promise<string> {
    if (!this.deps.handlers.humanApproval) throw new Error('No human approval handler registered');
    const decision = await this.deps.handlers.humanApproval(node, run);
    run.status = 'awaiting_approval';
    return `Approval requested: ${decision.decisionId}`;
  }

  private async execHuman(node: WorkflowNodeDef, run: WorkflowRun): Promise<string> {
    if (this.deps.handlers.humanTask) {
      const task = await this.deps.handlers.humanTask(node, run);
      run.status = 'awaiting_human';
      return `Human task submitted: ${task.taskId}`;
    } else if (this.deps.handlers.humanApproval) {
      const decision = await this.deps.handlers.humanApproval(node, run);
      const output = `Human task: decision ${decision.decisionId}`;
      if (decision.status === 'pending') run.status = 'awaiting_approval';
      return output;
    }
    throw new Error('No human handler registered');
  }

  private async execExternalAgent(node: WorkflowNodeDef, run: WorkflowRun, previousOutputs: string): Promise<string> {
    if (!this.deps.handlers.dispatchToExternalAgent) {
      throw new Error('No external agent dispatch handler registered');
    }
    const agentId = node.agentId ?? node.role ?? node.id;
    const allOutputs = run.steps.map((s) => s.output);
    const slot = {
      project: { name: 'workflow', goals: [] },
      memories: [], preferences: {}, files: [],
      discoveries: [], previous_outputs: allOutputs,
      security: { level: 'L1', tier: 'auto', maxRetries: 2 },
    };
    const result = await this.deps.handlers.dispatchToExternalAgent(agentId, {
      runId: run.runId, nodeId: node.id,
      input: previousOutputs, previousOutputs: allOutputs, slot,
    });
    if (result.status === 'awaiting_approval') {
      run.status = 'awaiting_approval';
      return `External agent ${agentId} awaiting approval: ${result.decisionId ?? ''}`;
    } else if (result.status === 'failed') {
      throw new Error(`External agent ${agentId} failed`);
    }
    return typeof result.output === 'string' ? result.output : JSON.stringify(result.output ?? {});
  }

  private async execManager(
    node: WorkflowNodeDef, run: WorkflowRun,
    nodeMap: Map<string, WorkflowNodeDef>,
    executeNode: (nodeId: string, nodeMap: Map<string, WorkflowNodeDef>, graph: Map<string, string[]>, run: WorkflowRun, visited: Set<string>) => Promise<void>,
  ): Promise<string> {
    const childNodes = node.children ?? [];
    if (childNodes.length === 0) return 'Manager: no children to coordinate';

    const childIds = new Set(childNodes.map((c) => c.id));
    const childEdges = this.deps.currentEdges.filter((e) => childIds.has(e.from) && childIds.has(e.to));
    const childGraph = buildAdjacencyGraph(childNodes, childEdges);
    const childMap = new Map(childNodes.map((c) => [c.id, c]));

    const managerDeps: ManagerContextDeps = {
      children: childNodes,
      executeChild: async (childNodeId, input) => {
        const savedSteps = [...run.steps];
        const syntheticStep: import('@cabinet/types').WorkflowRunStep = {
          nodeId: '__manager_input__',
          type: 'pass',
          output: input.previousOutputs,
          items: input.upstreamItems.flatMap((u) => u.items),
        };
        run.steps.push(syntheticStep);
        await executeNode(childNodeId, childMap, childGraph, run, new Set([node.id]));
        const childStep = run.steps.find((s) => s.nodeId === childNodeId);
        run.steps = savedSteps;
        if (!childStep) throw new Error(`Manager child ${childNodeId} produced no output`);
        return childStep;
      },
      planWithLLM: async (prompt) => {
        if (!this.deps.handlers.aiAgent) throw new Error('No aiAgent handler for manager planning');
        return this.deps.handlers.aiAgent(node, prompt);
      },
      reviewWithLLM: async (prompt) => {
        if (!this.deps.handlers.aiAgent) throw new Error('No aiAgent handler for manager review');
        return this.deps.handlers.aiAgent(node, prompt);
      },
      synthesizeWithLLM: async (prompt) => {
        if (!this.deps.handlers.aiAgent) throw new Error('No aiAgent handler for manager synthesis');
        return this.deps.handlers.aiAgent(node, prompt);
      },
      maxRounds: node.managerConfig?.maxRounds ?? 5,
    };

    const nodeInput = buildNodeInput(run, node.id, this.deps.currentEdges);
    return await ManagerExecutor.run(node, nodeInput, managerDeps);
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private compareOp(val: string, op: string, expected: string): boolean {
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
      case 'matches': {
        try { return new RegExp(expected).test(val); } catch { return false; }
      }
      default: return val === expected;
    }
  }

  private async evaluateCondition(expr: string, previousOutputs: string, run: WorkflowRun): Promise<boolean> {
    if (!expr || expr === 'true') return true;
    if (expr === 'false') return false;
    try {
      const { evaluateCondition: evaluateExpr } = await import('./condition-evaluator.js');
      return evaluateExpr(expr, {
        resolve: (path: string) => resolveVariable(path, run),
      });
    } catch {
      return previousOutputs.toLowerCase().includes(expr.toLowerCase());
    }
  }
}

function forkSlot(parentSlot: import('@cabinet/types').ContextSlot): import('@cabinet/types').ContextSlot {
  return {
    ...parentSlot,
    discoveries: [...parentSlot.discoveries],
    previous_outputs: [...parentSlot.previous_outputs],
  };
}
