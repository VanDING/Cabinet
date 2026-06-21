import dagre from 'dagre';
import type { CanvasNode, CanvasNodeData, CanvasNodeType } from './node-types';
import type { WorkflowNodeDef } from '@cabinet/types';

export function definitionToCanvas(
  def: {
    nodes?: WorkflowNodeDef[];
    edges?: { from: string; to: string; branch?: string; label?: string }[];
  },
  savedNodes?: CanvasNode[],
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const serverNodes = def.nodes ?? [];
  const serverEdges = def.edges ?? [];

  const positionMap = new Map<string, { x: number; y: number }>();
  if (savedNodes) {
    for (const n of savedNodes) positionMap.set(n.id, n.position);
  }

  const nodes: CanvasNode[] = [];
  let needsLayout = false;

  // Flatten nested nodes and restore parentId relationships
  function addNode(
    raw: WorkflowNodeDef,
    parentId?: string,
    parentOffset?: { x: number; y: number },
  ) {
    const savedPos = positionMap.get(raw.id);
    if (!savedPos && !parentId) needsLayout = true;

    const data: CanvasNodeData = {
      title: raw.title,
      description: raw.description,
      role: raw.role,
      systemPrompt: raw.systemPrompt,
      model: raw.model,
      persistent: raw.persistent,
      allowedTools: raw.allowedTools,
      prompt: raw.prompt,
      temperature: raw.temperature,
      maxTokens: raw.maxTokens,
      outputFormat: raw.outputFormat,
      skillId: raw.skillId,
      toolId: raw.toolId,
      inputMapping: raw.inputMapping,
      code: raw.code,
      codeTimeout: raw.codeTimeout,
      workflowId: raw.workflowId,
      branches: raw.branches,
      loopType: raw.loopType,
      loopCount: raw.loopCount,
      loopCondition: raw.loopCondition,
      waitStrategy: raw.waitStrategy,
      failStrategy: raw.failStrategy,
      mergeStrategy: raw.mergeStrategy,
      intents: raw.intents,
      intentThreshold: raw.intentThreshold,
      kbId: raw.kbId,
      queryTemplate: raw.queryTemplate,
      topK: raw.topK,
      scoreThreshold: raw.scoreThreshold,
      approvalTitle: raw.approvalTitle,
      options: raw.options,
      outputSchema: raw.outputSchema,
      humanDeadline: raw.humanDeadline,
      input: raw.input,
      output: raw.output,
      outputAs: raw.outputAs,
    };

    const basePos = savedPos ?? { x: 0, y: 0 };
    const position = parentOffset
      ? { x: basePos.x - parentOffset.x, y: basePos.y - parentOffset.y }
      : basePos;

    nodes.push({
      id: raw.id,
      type: raw.type as CanvasNodeType,
      position,
      data,
      parentId,
      extent: parentId ? 'parent' : undefined,
    });

    // Recursively add children
    if (raw.children && raw.children.length > 0) {
      const childOffset = parentOffset
        ? { x: parentOffset.x + position.x, y: parentOffset.y + position.y }
        : position;
      // If no saved positions for children, arrange them in a grid inside parent
      const hasSavedChildPositions = raw.children.some((c) => positionMap.has(c.id));
      if (!hasSavedChildPositions) {
        // Auto-layout children inside parent
        let cx = 20;
        let cy = 50;
        const colWidth = 220;
        const rowHeight = 80;
        for (let i = 0; i < raw.children.length; i++) {
          const child = raw.children[i];
          if (!child) continue;
          if (!positionMap.has(child.id)) {
            positionMap.set(child.id, { x: cx, y: cy });
          }
          cx += colWidth;
          if (cx > 400) {
            cx = 20;
            cy += rowHeight;
          }
        }
      }
      for (const child of raw.children) {
        addNode(child, raw.id, childOffset);
      }
    }
  }

  for (const raw of serverNodes) {
    addNode(raw);
  }

  const edges: CanvasEdge[] = serverEdges.map((e) => ({
    id: `e_${e.from}_${e.to}_${e.branch ?? 'default'}`,
    source: e.from,
    target: e.to,
    sourceHandle: e.branch ?? undefined,
    label: e.label,
    type: 'smoothstep',
    animated: false,
    markerEnd: { type: 'arrowclosed', width: 12, height: 12 },
  }));

  if (needsLayout) dagreLayout(nodes, edges);

  return { nodes, edges };
}

export function canvasToDefinition(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): {
  nodes: WorkflowNodeDef[];
  edges: { from: string; to: string; branch?: string; label?: string }[];
  capabilities?: Record<string, unknown>;
} {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const childrenMap = new Map<string, CanvasNode[]>();

  // Build parent → children mapping
  for (const n of nodes) {
    if (n.parentId) {
      if (!childrenMap.has(n.parentId)) childrenMap.set(n.parentId, []);
      childrenMap.get(n.parentId)!.push(n);
    }
  }

  function buildDef(n: CanvasNode): WorkflowNodeDef {
    const d = n.data ?? {};
    const def: WorkflowNodeDef = {
      id: n.id,
      type: n.type as WorkflowNodeDef['type'],
      title: d.title ?? '',
      description: d.description,
      role: d.role,
      systemPrompt: d.systemPrompt,
      model: d.model,
      persistent: d.persistent,
      allowedTools: d.allowedTools,
      prompt: d.prompt,
      temperature: d.temperature,
      maxTokens: d.maxTokens,
      outputFormat: d.outputFormat,
      skillId: d.skillId,
      toolId: d.toolId,
      inputMapping: d.inputMapping,
      code: d.code,
      codeTimeout: d.codeTimeout,
      workflowId: d.workflowId,
      branches: d.branches,
      loopType: d.loopType,
      loopCount: d.loopCount,
      loopCondition: d.loopCondition,
      loopMaxIterations: 1000,
      waitStrategy: d.waitStrategy,
      failStrategy: d.failStrategy,
      mergeStrategy: d.mergeStrategy,
      intents: d.intents,
      intentThreshold: d.intentThreshold,
      kbId: d.kbId,
      queryTemplate: d.queryTemplate,
      topK: d.topK,
      scoreThreshold: d.scoreThreshold,
      approvalTitle: d.approvalTitle,
      options: d.options,
      outputSchema: d.outputSchema,
      humanDeadline: d.humanDeadline,
      input: d.input,
      output: d.output,
      outputAs: d.outputAs,
      data: d,
    };

    const children = childrenMap.get(n.id);
    if (children && children.length > 0) {
      def.children = children.map((c) => buildDef(c));
    }

    return def;
  }

  // Only top-level nodes (no parentId) go into the output
  const topLevelNodes = nodes.filter((n) => !n.parentId);
  const outNodes = topLevelNodes.map((n) => buildDef(n));

  const outEdges = edges.map((e) => ({
    from: e.source,
    to: e.target,
    branch: e.sourceHandle as string | undefined,
    label: e.label as string | undefined,
  }));

  return {
    nodes: outNodes,
    edges: outEdges,
    capabilities: {
      files: { read: true, write: true },
      web: { fetch: true, http: true },
      shell: true,
      scheduler: true,
      knowledge: { search: true, index: true },
      evaluation: true,
    },
  };
}

function dagreLayout(nodes: CanvasNode[], edges: CanvasEdge[]): void {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 80, marginx: 40, marginy: 40 });
  for (const n of nodes) g.setNode(n.id, { width: 200, height: 60 });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  for (const n of nodes) {
    const dn = g.node(n.id);
    if (dn) n.position = { x: dn.x - 100, y: dn.y - 30 };
  }
}

type CanvasEdge = import('./node-types').CanvasEdge;
