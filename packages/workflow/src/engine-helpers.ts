import type { WorkflowNodeDef, WorkflowRunStep, StructuredInput } from '@cabinet/types';
import type { WorkflowEdge, WorkflowRun } from './engine.js';

// ── Slot Fork / Merge ───────────────────────────────────────────

export function forkSlot(parentSlot: ContextSlot): ContextSlot {
  return {
    ...parentSlot,
    discoveries: [...parentSlot.discoveries],
    previous_outputs: [...parentSlot.previous_outputs],
  };
}

export function mergeSlots(main: ContextSlot, forks: ContextSlot[]): ContextSlot {
  const allDiscoveries = [...main.discoveries, ...forks.flatMap((f) => f.discoveries)];
  const allOutputs = [...main.previous_outputs, ...forks.flatMap((f) => f.previous_outputs)];
  return {
    ...main,
    discoveries: allDiscoveries,
    previous_outputs: allOutputs,
  };
}

// ── Graph Builders ──────────────────────────────────────────────

export function buildAdjacencyGraph(nodes: WorkflowNodeDef[], edges: WorkflowEdge[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const n of nodes) graph.set(n.id, []);
  for (const e of edges) {
    if (!graph.has(e.from)) graph.set(e.from, []);
    graph.get(e.from)!.push(e.to);
  }
  return graph;
}

// ── Node Input Builder ──────────────────────────────────────────

export function buildNodeInput(run: WorkflowRun, nodeId: string, currentEdges: WorkflowEdge[]): StructuredInput {
  const incoming = currentEdges.filter((e) => e.to === nodeId);
  const upstreamNodeIds = new Set(incoming.map((e) => e.from));

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

// ── Variable / Value Resolution ─────────────────────────────────

export function resolveVariable(template: string, run: WorkflowRun): string {
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

export function resolveValue(field: string, run: WorkflowRun): string {
  if (field.startsWith('{{') && field.endsWith('}}')) {
    return resolveVariable(field, run);
  }
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

export function findChildForBranch(
  nodeId: string,
  branchLabel: string,
  graph: Map<string, string[]>,
  currentEdges: WorkflowEdge[],
): string | undefined {
  const children = graph.get(nodeId) ?? [];
  for (const childId of children) {
    const edge = currentEdges.find((e) => e.from === nodeId && e.to === childId);
    if (!edge || edge.label === branchLabel) return childId;
  }
  return children[0];
}

// ── Timeout Helper ──────────────────────────────────────────────

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

// Need ContextSlot type locally for forkSlot / mergeSlots
type ContextSlot = import('@cabinet/types').ContextSlot;
