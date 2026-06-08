import type {
  Blueprint,
  BlueprintAgent,
  BlueprintWorkflowStep,
  BlueprintAuthorizationRule,
  BlueprintHarnessGate,
  BlueprintIssue,
  BlueprintValidationResult,
} from '@cabinet/types';

export type {
  Blueprint,
  BlueprintAgent,
  BlueprintWorkflowStep,
  BlueprintAuthorizationRule,
  BlueprintHarnessGate,
  BlueprintIssue,
  BlueprintValidationResult,
};

export function validateBlueprint(
  blueprint: Blueprint,
  existingAgentNames?: Set<string>,
): BlueprintValidationResult {
  const issues: BlueprintIssue[] = [];
  const knownAgents = new Set(existingAgentNames ?? []);

  for (const agent of blueprint.agents ?? []) {
    if (agent.action === 'create_new' && agent.name) {
      knownAgents.add(agent.name);
    }
  }

  const steps = blueprint.workflow?.steps ?? [];
  const stepIds = new Set(steps.map((s) => s.id));
  const gates = blueprint.harness?.gates ?? [];
  const rules = blueprint.authorization?.rules ?? [];

  for (const agent of blueprint.agents ?? []) {
    if (agent.action === 'use_existing' && !knownAgents.has(agent.name)) {
      issues.push({
        node: agent.name,
        type: 'missing_agent',
        detail: `Agent "${agent.name}" is marked as use_existing but not found in registry and not created by this blueprint.`,
      });
    }
  }

  for (const step of steps) {
    const fromId = step.input?.from;
    if (fromId && fromId !== 'trigger' && !stepIds.has(fromId)) {
      issues.push({
        node: step.id,
        type: 'missing_step',
        detail: `Step "${step.id}" references input.from="${fromId}" which does not exist.`,
      });
    }
  }

  for (const step of steps) {
    if (step.condition?.trueBranch && !stepIds.has(step.condition.trueBranch)) {
      issues.push({
        node: step.id,
        type: 'invalid_branch',
        detail: `Condition trueBranch "${step.condition.trueBranch}" does not exist.`,
      });
    }
    if (step.condition?.falseBranch && !stepIds.has(step.condition.falseBranch)) {
      issues.push({
        node: step.id,
        type: 'invalid_branch',
        detail: `Condition falseBranch "${step.condition.falseBranch}" does not exist.`,
      });
    }
  }

  for (const step of steps) {
    for (const childId of step.children ?? []) {
      if (!stepIds.has(childId)) {
        issues.push({
          node: step.id,
          type: 'missing_step',
          detail: `Parallel child "${childId}" does not exist.`,
        });
      }
    }
  }

  const authorizedNodes = new Set<string>();
  for (const rule of rules) {
    if (rule.node_id) authorizedNodes.add(rule.node_id);
  }
  for (const step of steps) {
    if (
      (step.type === 'approval' || (step.type as string) === 'humanApproval') &&
      !authorizedNodes.has(step.id)
    ) {
      const hasDefault = rules.some((r) => r.default !== undefined);
      if (!hasDefault) {
        issues.push({
          node: step.id,
          type: 'missing_auth',
          detail: `approval step "${step.id}" has no authorization rule and no default rule exists.`,
        });
      }
    }
  }

  for (const gate of gates) {
    if (!stepIds.has(gate.node_id)) {
      issues.push({
        node: gate.node_id,
        type: 'invalid_gate',
        detail: `Harness gate references step "${gate.node_id}" which does not exist.`,
      });
    }
  }

  const circular = detectCircularDependencies(steps);
  for (const cycle of circular) {
    issues.push({
      node: cycle.join(' → '),
      type: 'circular_dependency',
      detail: `Circular dependency detected: ${cycle.join(' → ')}`,
    });
  }

  return { valid: issues.length === 0, issues };
}

export function detectCircularDependencies(steps: BlueprintWorkflowStep[]): string[][] {
  const stepIds = new Set(steps.map((s) => s.id));
  const edges = new Map<string, string[]>();

  for (const step of steps) {
    const targets: string[] = [];
    const fromId = step.input?.from;
    if (fromId && fromId !== 'trigger' && stepIds.has(fromId)) {
      targets.push(fromId);
    }
    if (step.condition?.trueBranch) targets.push(step.condition.trueBranch);
    if (step.condition?.falseBranch) targets.push(step.condition.falseBranch);
    for (const childId of step.children ?? []) {
      targets.push(childId);
    }
    edges.set(step.id, targets);
  }

  const cycles: string[][] = [];
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  for (const id of stepIds) color.set(id, WHITE);

  function dfs(node: string, path: string[]): void {
    color.set(node, GRAY);
    path.push(node);

    for (const neighbor of edges.get(node) ?? []) {
      const c = color.get(neighbor);
      if (c === GRAY) {
        const cycleStart = path.indexOf(neighbor);
        cycles.push([...path.slice(cycleStart), neighbor]);
      } else if (c === WHITE) {
        dfs(neighbor, path);
      }
    }

    path.pop();
    color.set(node, BLACK);
  }

  for (const id of stepIds) {
    if (color.get(id) === WHITE) dfs(id, []);
  }

  return cycles;
}
