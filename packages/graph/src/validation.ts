export interface EdgeDef {
  type: 'static' | 'conditional';
  from: string;
  to: string;
  conditionValue?: string;
}

export interface CompileError {
  pass: string;
  severity: 'error' | 'warning';
  message: string;
  context?: { nodeId?: string; edgeFrom?: string; edgeTo?: string };
}

export interface ValidationResult {
  ok: boolean;
  errors: CompileError[];
  warnings: CompileError[];
}

export function validateGraph(
  nodeIds: Set<string>,
  edges: EdgeDef[],
  entry: string,
): ValidationResult {
  const errors: CompileError[] = [];
  const warnings: CompileError[] = [];

  // Pass 1: Node existence (skip __END__ sentinel)
  for (const edge of edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push({
        pass: 'pass_1_nodes',
        severity: 'error',
        message: `Edge source "${edge.from}" is not a registered node`,
        context: { edgeFrom: edge.from, edgeTo: edge.to },
      });
    }
    if (edge.to !== '__END__' && !nodeIds.has(edge.to)) {
      errors.push({
        pass: 'pass_1_nodes',
        severity: 'error',
        message: `Edge target "${edge.to}" is not a registered node`,
        context: { edgeFrom: edge.from, edgeTo: edge.to },
      });
    }
  }

  // Pass 2: Entry reachability
  if (!nodeIds.has(entry)) {
    errors.push({
      pass: 'pass_2_reachability',
      severity: 'error',
      message: `Entry node "${entry}" is not a registered node`,
    });
  }

  const reachable = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const edge of edges) {
      if (edge.from === current && edge.to !== '__END__' && !reachable.has(edge.to)) {
        queue.push(edge.to);
      }
    }
  }

  for (const id of nodeIds) {
    if (!reachable.has(id)) {
      warnings.push({
        pass: 'pass_2_reachability',
        severity: 'warning',
        message: `Node "${id}" is unreachable from entry "${entry}"`,
        context: { nodeId: id },
      });
    }
  }

  // Pass 3: Cycle detection
  const cycles = findCycles(nodeIds, edges);
  for (const cycle of cycles) {
    const hasConditionalExit = edges.some(
      (e) => cycle.has(e.from) && e.type === 'conditional' && !cycle.has(e.to),
    );
    if (!hasConditionalExit) {
      warnings.push({
        pass: 'pass_3_cycles',
        severity: 'warning',
        message: `Cycle detected: ${[...cycle].join(' → ')} has no conditional exit edge`,
        context: { nodeId: [...cycle][0] },
      });
    }
  }

  // Pass 4: Conditional completeness
  const nodesWithConditionals = new Set<string>();
  for (const edge of edges) {
    if (edge.type === 'conditional') {
      nodesWithConditionals.add(edge.from);
    }
  }

  for (const nodeId of nodesWithConditionals) {
    const condEdges = edges.filter((e) => e.from === nodeId && e.type === 'conditional');
    const hasDefault = condEdges.some((e) => e.conditionValue === '__default__');
    if (!hasDefault) {
      errors.push({
        pass: 'pass_4_conditionals',
        severity: 'error',
        message: `Conditional edges from "${nodeId}" have no default (__default__) target`,
        context: { nodeId },
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

/** Find cycles via DFS back-edge detection. */
function findCycles(nodeIds: Set<string>, edges: EdgeDef[]): Set<string>[] {
  const cycles: Set<string>[] = [];
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const id of nodeIds) color.set(id, WHITE);

  function dfs(node: string, path: Set<string>) {
    color.set(node, GRAY);
    path.add(node);

    const neighbors = edges.filter((e) => e.from === node && e.to !== '__END__').map((e) => e.to);
    for (const neighbor of neighbors) {
      if (path.has(neighbor)) {
        const cycleNodes = new Set<string>();
        let inCycle = false;
        for (const p of path) {
          if (p === neighbor) inCycle = true;
          if (inCycle) cycleNodes.add(p);
        }
        cycleNodes.add(neighbor);
        if (cycleNodes.size >= 2) {
          cycles.push(cycleNodes);
        }
      } else if (color.get(neighbor) === WHITE) {
        dfs(neighbor, new Set(path));
      }
    }

    color.set(node, BLACK);
    path.delete(node);
  }

  for (const id of nodeIds) {
    if (color.get(id) === WHITE) {
      dfs(id, new Set());
    }
  }

  return cycles;
}
