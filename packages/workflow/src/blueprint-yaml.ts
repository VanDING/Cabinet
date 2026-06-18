//
// Blueprint YAML Parser — converts parsed YAML objects to WorkflowNodeDef[] + WorkflowEdge[].
//
// Replaces the EL compiler as the sole external workflow definition format.
//

import type { WorkflowNodeDef, WorkflowNodeType } from '@cabinet/types';
import type { WorkflowEdge } from './engine.js';

export interface YamlBlueprint {
  name: string;
  entry: string;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
}

export interface YamlParseResult {
  ok: boolean;
  nodes?: WorkflowNodeDef[];
  edges?: WorkflowEdge[];
  entry?: string;
  name?: string;
  errors?: string[];
}

/**
 * Parse a YAML blueprint object (already parsed by a YAML library) into
 * WorkflowNodeDef[] + WorkflowEdge[].
 */

export function parseYamlBlueprint(parsed: unknown): YamlParseResult {
  const errors: string[] = [];

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, errors: ['Invalid YAML: expected an object'] };
  }

  const obj = parsed as Record<string, unknown>;

  const name = typeof obj.name === 'string' ? obj.name : undefined;
  const entry = typeof obj.entry === 'string' ? obj.entry : undefined;

  if (!name) errors.push('Missing required field: name');
  if (!entry) errors.push('Missing required field: entry');

  // Parse nodes
  const nodes: WorkflowNodeDef[] = [];
  if (!Array.isArray(obj.nodes)) {
    errors.push('Missing or invalid field: nodes (expected array)');
  } else {
    for (let i = 0; i < obj.nodes.length; i++) {
      const n = obj.nodes[i];
      if (!n || typeof n !== 'object') {
        errors.push(`nodes[${i}]: expected object`);
        continue;
      }
      const node = n as Record<string, unknown>;
      const id = typeof node.id === 'string' ? node.id : undefined;
      const type = typeof node.type === 'string' ? (node.type as WorkflowNodeType) : undefined;

      if (!id) errors.push(`nodes[${i}]: missing id`);
      if (!type) errors.push(`nodes[${i}]: missing or invalid type`);

      nodes.push({
        id: id ?? `node_${i}`,
        type: type ?? 'start',
        title: typeof node.title === 'string' ? node.title : undefined,
        description: typeof node.description === 'string' ? node.description : undefined,
        agentId: typeof node.agentId === 'string' ? node.agentId : undefined,
        role: typeof node.role === 'string' ? node.role : undefined,
        systemPrompt: typeof node.systemPrompt === 'string' ? node.systemPrompt : undefined,
        model: typeof node.model === 'string' ? node.model : undefined,
        persistent: typeof node.persistent === 'boolean' ? node.persistent : undefined,
        allowedTools: Array.isArray(node.allowedTools)
          ? node.allowedTools.filter((t): t is string => typeof t === 'string')
          : undefined,
        prompt: typeof node.prompt === 'string' ? node.prompt : undefined,
        temperature: typeof node.temperature === 'number' ? node.temperature : undefined,
        maxTokens: typeof node.maxTokens === 'number' ? node.maxTokens : undefined,
        outputFormat:
          node.outputFormat === 'text' ||
          node.outputFormat === 'json' ||
          node.outputFormat === 'markdown'
            ? node.outputFormat
            : undefined,
        skillId: typeof node.skillId === 'string' ? node.skillId : undefined,
        toolId: typeof node.toolId === 'string' ? node.toolId : undefined,
        code: typeof node.code === 'string' ? node.code : undefined,
        codeTimeout: typeof node.codeTimeout === 'number' ? node.codeTimeout : undefined,
        workflowId: typeof node.workflowId === 'string' ? node.workflowId : undefined,
        synchronous: typeof node.synchronous === 'boolean' ? node.synchronous : undefined,
        loopType:
          node.loopType === 'count' || node.loopType === 'condition' ? node.loopType : undefined,
        loopCount: typeof node.loopCount === 'number' ? node.loopCount : undefined,
        loopCondition: typeof node.loopCondition === 'string' ? node.loopCondition : undefined,
        loopMaxIterations:
          typeof node.loopMaxIterations === 'number' ? node.loopMaxIterations : undefined,
        loopOutputMode:
          node.loopOutputMode === 'array' ||
          node.loopOutputMode === 'last' ||
          node.loopOutputMode === 'merge'
            ? node.loopOutputMode
            : undefined,
        waitStrategy:
          node.waitStrategy === 'all' || node.waitStrategy === 'first'
            ? node.waitStrategy
            : undefined,
        failStrategy:
          node.failStrategy === 'failAll' || node.failStrategy === 'continue'
            ? node.failStrategy
            : undefined,
        mergeStrategy:
          node.mergeStrategy === 'object' ||
          node.mergeStrategy === 'array' ||
          node.mergeStrategy === 'concat' ||
          node.mergeStrategy === 'firstNotNull'
            ? node.mergeStrategy
            : undefined,
        mergeTimeout: typeof node.mergeTimeout === 'number' ? node.mergeTimeout : undefined,
        kbId: typeof node.kbId === 'string' ? node.kbId : undefined,
        queryTemplate: typeof node.queryTemplate === 'string' ? node.queryTemplate : undefined,
        topK: typeof node.topK === 'number' ? node.topK : undefined,
        scoreThreshold: typeof node.scoreThreshold === 'number' ? node.scoreThreshold : undefined,
        approvalTitle: typeof node.approvalTitle === 'string' ? node.approvalTitle : undefined,
        options: Array.isArray(node.options)
          ? node.options.filter((o): o is string => typeof o === 'string')
          : undefined,
        outputSchema:
          typeof node.outputSchema === 'object' && node.outputSchema !== null
            ? (node.outputSchema as Record<string, unknown>)
            : undefined,
        humanDeadline: typeof node.humanDeadline === 'string' ? node.humanDeadline : undefined,
        onError: node.onError === 'stop' || node.onError === 'continue' ? node.onError : undefined,
        errorTriggerWorkflowId:
          typeof node.errorTriggerWorkflowId === 'string' ? node.errorTriggerWorkflowId : undefined,
        outputAs: typeof node.outputAs === 'string' ? node.outputAs : undefined,
        data:
          typeof node.data === 'object' && node.data !== null
            ? (node.data as Record<string, unknown>)
            : undefined,
      });
    }
  }

  // Parse edges
  const edges: WorkflowEdge[] = [];
  if (!Array.isArray(obj.edges)) {
    errors.push('Missing or invalid field: edges (expected array)');
  } else {
    for (let i = 0; i < obj.edges.length; i++) {
      const e = obj.edges[i];
      if (!e || typeof e !== 'object') {
        errors.push(`edges[${i}]: expected object`);
        continue;
      }
      const edge = e as Record<string, unknown>;
      const from = typeof edge.from === 'string' ? edge.from : undefined;
      const to = typeof edge.to === 'string' ? edge.to : undefined;

      if (!from) errors.push(`edges[${i}]: missing from`);
      if (!to) errors.push(`edges[${i}]: missing to`);

      edges.push({
        from: from ?? '',
        to: to ?? '',
        condition: typeof edge.condition === 'string' ? edge.condition : undefined,
        branch: edge.branch === 'true' || edge.branch === 'false' ? edge.branch : undefined,
        label: typeof edge.label === 'string' ? edge.label : undefined,
      });
    }
  }

  // Validate entry node exists
  if (entry && nodes.length > 0 && !nodes.some((n) => n.id === entry)) {
    errors.push(`Entry node "${entry}" not found in nodes`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, nodes, edges, entry: entry!, name: name! };
}
