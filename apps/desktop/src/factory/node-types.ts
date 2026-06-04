import type { Node, Edge } from '@xyflow/react';
import type { WorkflowNodeType } from '@cabinet/types';

// Canvas uses the same types as the engine now
export type CanvasNodeType = WorkflowNodeType;

export const CANVAS_NODE_TYPES: CanvasNodeType[] = [
  'start', 'end',
  'ifElse', 'loop', 'parallel', 'merge', 'pass',
  'agentGroup',
  'llm', 'skill', 'tool', 'code', 'workflow',
  'intentClassify', 'knowledgeBase',
  'approval', 'human',
];

export interface CanvasNodeData {
  title?: string;
  description?: string;
  role?: string;
  systemPrompt?: string;
  model?: string;
  persistent?: boolean;
  allowedTools?: string[];
  prompt?: string;
  temperature?: number;
  maxTokens?: number;
  outputFormat?: 'text' | 'json' | 'markdown';
  skillId?: string;
  toolId?: string;
  inputMapping?: Record<string, string>;
  code?: string;
  codeTimeout?: number;
  workflowId?: string;
  branches?: Array<{ label: string; conditions: Array<{ field: string; operator: string; value: string; logic: 'AND' | 'OR' }>; priority: number }>;
  loopType?: 'count' | 'condition';
  loopCount?: number;
  loopCondition?: string;
  waitStrategy?: 'all' | 'first';
  failStrategy?: 'failAll' | 'continue';
  mergeStrategy?: 'object' | 'array' | 'concat' | 'firstNotNull';
  intents?: Array<{ name: string; description: string; examples?: string[] }>;
  intentThreshold?: number;
  kbId?: string;
  queryTemplate?: string;
  topK?: number;
  scoreThreshold?: number;
  approvalTitle?: string;
  options?: string[];
  outputSchema?: Record<string, unknown>;
  humanDeadline?: string;
  input?: { source: 'previous' | 'named' | 'none'; mapping?: Record<string, string> };
  output?: { schema?: Record<string, string>; passThrough?: boolean };
  outputAs?: string;
  [key: string]: unknown;
}

export type CanvasNode = Node<CanvasNodeData, CanvasNodeType>;
export type CanvasEdge = Edge;

export const NODE_COLORS: Record<CanvasNodeType, string> = {
  start: 'bg-intent-success-muted border-intent-success',
  end: 'bg-surface-muted border-border',
  ifElse: 'bg-intent-warning-muted border-intent-warning',
  loop: 'bg-intent-info-muted border-intent-info',
  parallel: 'bg-intent-info-muted border-intent-info',
  merge: 'bg-intent-purple-muted border-intent-purple',
  pass: 'bg-surface-muted border-border',
  agentGroup: 'bg-accent-muted/20 border-accent',
  llm: 'bg-accent-muted border-accent',
  skill: 'bg-intent-purple-muted border-intent-purple',
  tool: 'bg-surface-muted border-border',
  code: 'bg-intent-info-muted border-intent-info',
  workflow: 'bg-intent-purple-muted border-intent-purple',
  intentClassify: 'bg-accent-muted border-accent',
  knowledgeBase: 'bg-intent-success-muted border-intent-success',
  approval: 'bg-intent-danger-muted border-intent-danger',
  human: 'bg-intent-danger-muted border-intent-danger',
};

export const NODE_LABELS: Record<CanvasNodeType, string> = {
  start: 'Start', end: 'End',
  ifElse: 'If-Else', loop: 'Loop', parallel: 'Parallel',
  merge: 'Merge', pass: 'Pass',
  agentGroup: 'Agent Group',
  llm: 'LLM', skill: 'Skill', tool: 'Tool',
  code: 'Code', workflow: 'Workflow',
  intentClassify: 'Intent', knowledgeBase: 'KB',
  approval: 'Approval', human: 'Human',
};
