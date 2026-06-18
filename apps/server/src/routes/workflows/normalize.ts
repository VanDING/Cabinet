import { type WorkflowNodeDef, type WorkflowEdge } from '@cabinet/workflow';
import type { WorkflowNodeType } from '@cabinet/types';

/**
 * Convert declarative WorkflowDefinition steps to internal node/edge DAG format.
 *
 * Declarative step format (canonical, designed for LLM generation):
 *   { id, type, title, description, prompt, agent, input?, condition?, approvalOptions?,
 *     constraints?, parallel?, template?, capabilities? }
 *
 * Edge generation rules:
 *   - input.from === "trigger" or absent → entry point (no incoming edge)
 *   - input.from === otherStepId → explicit edge from that step
 *   - Absent input.from → sequential (connect from previous non-condition step)
 *   - condition steps → no sequential out-edges; trueBranch/falseBranch create explicit edges
 *   - humanApproval with retryTarget → condition edge back to retry target
 */
function normalizeNodeType(type: string | undefined): string {
  switch (type) {
    case 'aiAgent':
      return 'agentGroup';
    case 'llmCall':
      return 'llm';
    case 'condition':
      return 'ifElse';
    case 'humanApproval':
      return 'approval';
    case 'dataQuery':
      return 'tool';
    case 'notification':
      return 'pass';
    case 'wait':
      return 'pass';
    default:
      return type ?? 'agentGroup';
  }
}

function convertStepsToNodes(steps: any[]): { nodes: WorkflowNodeDef[]; edges: WorkflowEdge[] } {
  const nodes: WorkflowNodeDef[] = [];
  const edges: WorkflowEdge[] = [];
  const nodeIds = new Set<string>(steps.map((s) => s.id));

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const prevStep = i > 0 ? steps[i - 1] : null;

    // Normalize legacy step type names to current engine node types
    const normalizedType = normalizeNodeType(step.type);

    nodes.push({
      id: step.id,
      type: normalizedType as WorkflowNodeType,
      title: step.title,
      skillId: step.skillId,
      loopCondition: (step as any).condition?.expression ?? (step as any).condition,
      data: {
        label: step.title,
        prompt: step.prompt ?? step.description,
        model: step.constraints?.model,
        maxTokens: step.constraints?.maxTokens,
        temperature: step.constraints?.temperature,
        maxRetries: step.constraints?.maxRetries,
        aggregation: step.parallel?.aggregation,
        message: step.notification?.message,
        template: step.template,
      },
      role: step.agent,
      persistent: step.constraints?.persistent,
    });

    // ── Edge generation ──

    // Condition nodes: explicit branches only, no auto-sequencing
    if (step.type === 'condition') {
      const cond = step.condition ?? {};
      if (cond.trueBranch && nodeIds.has(cond.trueBranch)) {
        edges.push({ from: step.id, to: cond.trueBranch, condition: 'true' });
      }
      if (cond.falseBranch && nodeIds.has(cond.falseBranch)) {
        edges.push({ from: step.id, to: cond.falseBranch, condition: 'false' });
      }
      // If no branches specified, it's a sequential condition — connect to next step
      if (!cond.trueBranch && !cond.falseBranch && prevStep) {
        // Don't auto-connect — condition with no branches is a no-op
      }
      continue;
    }

    // Explicit input.from
    if (step.input?.from) {
      const fromId = step.input.from as string;
      if (fromId !== 'trigger' && nodeIds.has(fromId)) {
        // Check if an edge already exists from this source to this target
        const exists = edges.some((e) => e.from === fromId && e.to === step.id);
        if (!exists) {
          edges.push({ from: fromId, to: step.id });
        }
      }
      // fromId === "trigger" → entry point, no incoming edge
      continue;
    }

    // Default: sequential connection from previous step
    // Skip if previous was a condition (condition handles its own edges)
    const prevIsCondition = prevStep?.type === 'condition';
    const prevConditionHandlesThis =
      prevIsCondition &&
      (prevStep?.condition?.trueBranch === step.id || prevStep?.condition?.falseBranch === step.id);

    if (prevStep && !prevIsCondition) {
      edges.push({ from: prevStep.id, to: step.id });
    } else if (prevStep && prevIsCondition && !prevConditionHandlesThis) {
      // Previous was condition but this step isn't a branch target — connect anyway
      edges.push({ from: prevStep.id, to: step.id });
    }

    // humanApproval retry target
    if (
      (step.type === 'approval' || (step.type as string) === 'humanApproval') &&
      (step as any).approvalOptions?.retryTarget
    ) {
      const retryId = step.approvalOptions.retryTarget as string;
      if (nodeIds.has(retryId)) {
        edges.push({ from: step.id, to: retryId, condition: 'retry' });
      }
    }
  }

  return { nodes, edges };
}

export function normalizeDefinition(def: any): { nodes: WorkflowNodeDef[]; edges: WorkflowEdge[] } {
  // New format: WorkflowDefinition with steps array
  if (def.steps && Array.isArray(def.steps)) {
    return convertStepsToNodes(def.steps);
  }

  // Legacy format: { nodes, edges }
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
    agentId: n.agentId ?? n.data?.agentId,
    agentConfig: n.agentConfig ?? n.data?.agentConfig,
  }));

  const edges: WorkflowEdge[] = rawEdges.map((e: any) => ({
    from: e.from ?? e.source,
    to: e.to ?? e.target,
    condition: e.condition,
  }));

  return { nodes, edges };
}

export function findEntryNode(nodes: WorkflowNodeDef[]): string {
  const start = nodes.find((n) => n.type === 'start');
  if (start) return start.id;
  return nodes[0]?.id ?? '';
}
