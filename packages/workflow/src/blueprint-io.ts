//
// Blueprint I/O — Workflow import/export with versioned format (M4 Operational Plane).
//
// Format: cabinet-workflow/v1
//
// Exported JSON:
// {
//   "format": "cabinet-workflow/v1",
//   "exportedAt": "ISO timestamp",
//   "sourceInstance": "daemon_<hostname>",
//   "definition": { "nodes": [...], "edges": [...] },
//   "agents": { "<agentId>": { "harnessId": "...", "fallback": "generic" } },
//   "onError": "<errorTriggerWorkflowId | null>"
// }
//
// Import resolves agents against the local registry; missing agents get a
// fallback entry so the user can register them later.
//

import { hostname } from 'node:os';
import type { WorkflowNodeDef, WorkflowNodeType } from '@cabinet/types';
import type { WorkflowEdge } from './engine.js';

// ── Blueprint types ───────────────────────────────────────────────

export interface WorkflowBlueprint {
  format: 'cabinet-workflow/v1';
  exportedAt: string;
  sourceInstance: string;
  definition: {
    nodes: BlueprintNode[];
    edges: BlueprintEdge[];
  };
  /** Agent references: agentId → harness resolution info. */
  agents: Record<string, BlueprintAgentRef>;
  /** Workflow-level error trigger. */
  onError: string | null;
}

export interface BlueprintNode {
  id: string;
  type: WorkflowNodeType;
  title?: string;
  description?: string;
  // Core config
  agentId?: string;
  role?: string;
  systemPrompt?: string;
  model?: string;
  prompt?: string;
  // Children (recursive, for agentGroup/manager)
  children?: BlueprintNode[];
  // I/O
  input?: { source: 'previous' | 'named' | 'none'; mapping?: Record<string, string> };
  output?: { schema?: Record<string, string>; passThrough?: boolean; role?: string };
  outputAs?: string;
  // Error handling
  onError?: 'stop' | 'continue';
  errorTriggerWorkflowId?: string;
  // Node-type-specific config
  skillId?: string;
  toolId?: string;
  code?: string;
  codeTimeout?: number;
  workflowId?: string;
  synchronous?: boolean;
  squadId?: string;
  managerConfig?: {
    maxRounds?: number;
    planningPrompt?: string;
    reviewPrompt?: string;
    squadDelegation?: boolean;
  };
  branches?: Array<{
    label: string;
    conditions: Array<{ field: string; operator: string; value: string; logic: 'AND' | 'OR' }>;
    priority: number;
  }>;
  loopType?: 'count' | 'condition';
  loopCount?: number;
  loopCondition?: string;
  loopMaxIterations?: number;
  loopOutputMode?: 'array' | 'last' | 'merge';
  waitStrategy?: 'all' | 'first';
  failStrategy?: 'failAll' | 'continue';
  mergeStrategy?: 'object' | 'array' | 'concat' | 'firstNotNull';
  intents?: Array<{ name: string; description: string; examples?: string[] }>;
  kbId?: string;
  queryTemplate?: string;
  topK?: number;
  // Extra
  data?: Record<string, unknown>;
}

export interface BlueprintEdge {
  from: string;
  to: string;
  condition?: string;
  branch?: 'true' | 'false';
  label?: string;
}

export interface BlueprintAgentRef {
  harnessId: string;
  fallback: string;
  capabilities?: string[];
}

// ── Import result ─────────────────────────────────────────────────

export interface BlueprintImportResult {
  nodes: WorkflowNodeDef[];
  edges: WorkflowEdge[];
  /** Agents that were resolved successfully. */
  resolvedAgents: string[];
  /** Agents referenced in the blueprint but not found locally. */
  missingAgents: Array<{ agentId: string; harnessId: string; fallback: string }>;
}

// ── Export ────────────────────────────────────────────────────────

/**
 * Export workflow nodes and edges to the cabinet-workflow/v1 blueprint format.
 *
 * Strips runtime-only fields (children are preserved in agentGroup/manager nodes
 * since they define the workflow structure). Agent references are extracted
 * into the top-level agents map.
 */
export function exportBlueprint(
  nodes: WorkflowNodeDef[],
  edges: WorkflowEdge[],
  agentRegistry?: { get: (id: string) => { external?: { protocol?: string } } | null },
): WorkflowBlueprint {
  const agents: Record<string, BlueprintAgentRef> = {};

  // Extract agent references from nodes
  for (const node of nodes) {
    const agentId = node.agentId ?? node.role;
    if (agentId && !agents[agentId]) {
      const agentDef = agentRegistry?.get(agentId);
      agents[agentId] = {
        harnessId: agentDef?.external?.protocol === 'a2a' ? 'a2a' : 'generic',
        fallback: 'generic',
      };
    }
    // Recurse into children
    if (node.children) {
      for (const child of node.children) {
        const childAgentId = child.agentId ?? child.role;
        if (childAgentId && !agents[childAgentId]) {
          const childAgentDef = agentRegistry?.get(childAgentId);
          agents[childAgentId] = {
            harnessId: childAgentDef?.external?.protocol === 'a2a' ? 'a2a' : 'generic',
            fallback: 'generic',
          };
        }
      }
    }
  }

  // Convert nodes to blueprint format (strip runtime fields)
  const bpNodes: BlueprintNode[] = nodes.map((n) => nodeToBlueprint(n));

  return {
    format: 'cabinet-workflow/v1',
    exportedAt: new Date().toISOString(),
    sourceInstance: `daemon_${hostname()}`,
    definition: {
      nodes: bpNodes,
      edges: edges.map((e) => ({
        from: e.from,
        to: e.to,
        condition: e.condition,
        branch: e.branch,
        label: e.label,
      })),
    },
    agents,
    onError: null,
  };
}

// ── Import ────────────────────────────────────────────────────────

/**
 * Import a workflow blueprint back into WorkflowNodeDef[] and WorkflowEdge[].
 *
 * Resolves agent references against the local registry. Agents that can't be
 * resolved are listed in `missingAgents` for the caller to handle (e.g.,
 * prompt the user to register them).
 */
export function importBlueprint(
  blueprint: WorkflowBlueprint,
  agentRegistry?: { get: (id: string) => unknown },
): BlueprintImportResult {
  const resolvedAgents: string[] = [];
  const missingAgents: BlueprintImportResult['missingAgents'] = [];

  // Validate format
  if (blueprint.format !== 'cabinet-workflow/v1') {
    throw new Error(`Unsupported blueprint format: ${blueprint.format}. Expected cabinet-workflow/v1.`);
  }

  // Resolve agents
  for (const [agentId, ref] of Object.entries(blueprint.agents)) {
    if (agentRegistry?.get(agentId)) {
      resolvedAgents.push(agentId);
    } else {
      missingAgents.push({
        agentId,
        harnessId: ref.harnessId,
        fallback: ref.fallback,
      });
    }
  }

  // Convert blueprint nodes back to WorkflowNodeDef
  const nodes: WorkflowNodeDef[] = blueprint.definition.nodes.map((bn) =>
    blueprintToNode(bn),
  );

  const edges: WorkflowEdge[] = blueprint.definition.edges.map((be) => ({
    from: be.from,
    to: be.to,
    condition: be.condition,
    branch: be.branch,
    label: be.label,
  }));

  return { nodes, edges, resolvedAgents, missingAgents };
}

// ── Node conversion helpers ───────────────────────────────────────

function nodeToBlueprint(node: WorkflowNodeDef): BlueprintNode {
  const bn: BlueprintNode = {
    id: node.id,
    type: node.type,
    title: node.title,
    description: node.description,
    agentId: node.agentId,
    role: node.role,
    systemPrompt: node.systemPrompt,
    model: node.model,
    prompt: node.prompt,
    input: node.input,
    output: node.output ? {
      schema: node.output.schema,
      passThrough: node.output.passThrough,
      role: node.output.role,
    } : undefined,
    outputAs: node.outputAs,
    onError: node.onError,
    errorTriggerWorkflowId: node.errorTriggerWorkflowId,
    skillId: node.skillId,
    toolId: node.toolId,
    code: node.code,
    codeTimeout: node.codeTimeout,
    workflowId: node.workflowId,
    synchronous: node.synchronous,
    squadId: node.squadId,
    managerConfig: node.managerConfig,
    branches: node.branches,
    loopType: node.loopType,
    loopCount: node.loopCount,
    loopCondition: node.loopCondition,
    loopMaxIterations: node.loopMaxIterations,
    loopOutputMode: node.loopOutputMode,
    waitStrategy: node.waitStrategy,
    failStrategy: node.failStrategy,
    mergeStrategy: node.mergeStrategy,
    intents: node.intents,
    kbId: node.kbId,
    queryTemplate: node.queryTemplate,
    topK: node.topK,
    data: node.data,
  };

  // Recurse children
  if (node.children && node.children.length > 0) {
    bn.children = node.children.map((c) => nodeToBlueprint(c));
  }

  return bn;
}

function blueprintToNode(bn: BlueprintNode): WorkflowNodeDef {
  const node: WorkflowNodeDef = {
    id: bn.id,
    type: bn.type,
    title: bn.title,
    description: bn.description,
    agentId: bn.agentId,
    role: bn.role,
    systemPrompt: bn.systemPrompt,
    model: bn.model,
    prompt: bn.prompt,
    input: bn.input,
    output: bn.output ? {
      schema: bn.output.schema,
      passThrough: bn.output.passThrough,
      role: bn.output.role as 'intermediate' | 'final' | 'passthrough' | undefined,
    } : undefined,
    outputAs: bn.outputAs,
    onError: bn.onError,
    errorTriggerWorkflowId: bn.errorTriggerWorkflowId,
    skillId: bn.skillId,
    toolId: bn.toolId,
    code: bn.code,
    codeTimeout: bn.codeTimeout,
    workflowId: bn.workflowId,
    synchronous: bn.synchronous,
    squadId: bn.squadId,
    managerConfig: bn.managerConfig,
    branches: bn.branches,
    loopType: bn.loopType,
    loopCount: bn.loopCount,
    loopCondition: bn.loopCondition,
    loopMaxIterations: bn.loopMaxIterations,
    loopOutputMode: bn.loopOutputMode,
    waitStrategy: bn.waitStrategy,
    failStrategy: bn.failStrategy,
    mergeStrategy: bn.mergeStrategy,
    intents: bn.intents,
    kbId: bn.kbId,
    queryTemplate: bn.queryTemplate,
    topK: bn.topK,
    data: bn.data,
  };

  if (bn.children && bn.children.length > 0) {
    node.children = bn.children.map((c) => blueprintToNode(c));
  }

  return node;
}

// ── Validation ────────────────────────────────────────────────────

/**
 * Validate a blueprint structure without importing it.
 * Returns a list of issues (empty = valid).
 */
export function validateWorkflowBlueprint(blueprint: WorkflowBlueprint): string[] {
  const issues: string[] = [];

  if (!blueprint.format) {
    issues.push('Missing "format" field.');
  } else if (blueprint.format !== 'cabinet-workflow/v1') {
    issues.push(`Unsupported format: "${blueprint.format}". Expected "cabinet-workflow/v1".`);
  }

  if (!blueprint.definition) {
    issues.push('Missing "definition" field.');
    return issues;
  }

  if (!Array.isArray(blueprint.definition.nodes)) {
    issues.push('"definition.nodes" must be an array.');
  } else if (blueprint.definition.nodes.length === 0) {
    issues.push('"definition.nodes" is empty.');
  }

  if (!Array.isArray(blueprint.definition.edges)) {
    issues.push('"definition.edges" must be an array.');
  }

  // Validate node IDs are unique
  if (Array.isArray(blueprint.definition.nodes)) {
    const ids = new Set<string>();
    for (const node of blueprint.definition.nodes) {
      if (!node.id) {
        issues.push('A node is missing its "id".');
      } else if (ids.has(node.id)) {
        issues.push(`Duplicate node ID: "${node.id}".`);
      } else {
        ids.add(node.id);
      }
    }
  }

  // Validate edge references
  if (Array.isArray(blueprint.definition.nodes) && Array.isArray(blueprint.definition.edges)) {
    const nodeIds = new Set(blueprint.definition.nodes.map((n) => n.id));
    for (const edge of blueprint.definition.edges) {
      if (!nodeIds.has(edge.from)) {
        issues.push(`Edge references unknown source node: "${edge.from}".`);
      }
      if (!nodeIds.has(edge.to)) {
        issues.push(`Edge references unknown target node: "${edge.to}".`);
      }
    }
  }

  return issues;
}
