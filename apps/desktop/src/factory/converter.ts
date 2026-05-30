import dagre from 'dagre';
import type { CanvasNode, CanvasNodeData, CanvasNodeType } from './node-types';
import type { WorkflowNodeDef } from '@cabinet/types';

export function definitionToCanvas(
  def: { nodes?: WorkflowNodeDef[]; edges?: { from: string; to: string; branch?: string; label?: string }[] },
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

  for (const raw of serverNodes) {
    const savedPos = positionMap.get(raw.id);
    if (!savedPos) needsLayout = true;

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

    nodes.push({
      id: raw.id,
      type: raw.type as CanvasNodeType,
      position: savedPos ?? { x: 0, y: 0 },
      data,
    });
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
): { nodes: WorkflowNodeDef[]; edges: { from: string; to: string; branch?: string; label?: string }[] } {
  const outNodes: WorkflowNodeDef[] = nodes.map((n) => {
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
    return def;
  });

  const outEdges = edges.map((e) => ({
    from: e.source,
    to: e.target,
    branch: (e.sourceHandle as string | undefined),
    label: (e.label as string | undefined),
  }));

  return { nodes: outNodes, edges: outEdges };
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
