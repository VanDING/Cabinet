// ── Project ──

export const ProjectStatus = {
  Draft: 'draft',
  Active: 'active',
  Archived: 'archived',
} as const;

export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

export interface Project {
  readonly id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  rootPath?: string;
  archived?: boolean;
  lastActivityAt?: string;
  createdAt: Date;
}

export interface RiskItem {
  description: string;
  severity: 'low' | 'medium' | 'high';
  mitigation?: string;
}

export interface KeyDecisionItem {
  title: string;
  outcome: string;
  date?: string;
}

export interface ProjectContext {
  projectId: string;
  summary: string;
  goals: string[];
  constraints: Record<string, unknown>;
  techSummary: string;
  riskMap: RiskItem[];
  keyDecisions: KeyDecisionItem[];
}

// ── Employee ──

export const EmployeeKind = {
  AI: 'ai',
  Human: 'human',
} as const;

export type EmployeeKind = (typeof EmployeeKind)[keyof typeof EmployeeKind];

export const PermissionLevel = {
  Read: 'read',
  Write: 'write',
  Admin: 'admin',
} as const;

export type PermissionLevel = (typeof PermissionLevel)[keyof typeof PermissionLevel];

export interface AIPipelineConfig {
  model: string;
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface PersonaConfig {
  name: string;
  tone: string;
  expertise: string[];
}

export interface Employee {
  readonly id: string;
  projectId: string;
  name: string;
  role: string;
  kind: EmployeeKind;
  pipelineConfig?: AIPipelineConfig;
  persona?: PersonaConfig;
  permissionLevel: PermissionLevel;
}

// ── Skill ──

export const SkillKind = {
  Tool: 'tool',
  Prompt: 'prompt',
  Composite: 'composite',
} as const;

export type SkillKind = (typeof SkillKind)[keyof typeof SkillKind];

export const SkillStatus = {
  Draft: 'draft',
  Active: 'active',
  Deprecated: 'deprecated',
} as const;

export type SkillStatus = (typeof SkillStatus)[keyof typeof SkillStatus];

export interface SkillDefinition {
  readonly id: string;
  name: string;
  description: string;
  kind: SkillKind;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  promptTemplate: string;
  version: number;
  status: SkillStatus;
}

// ── Workflow (Declarative, LLM-friendly) ──

export type WorkflowStepType = 'start' | 'end' | 'skill' | 'aiAgent' | 'llmCall' | 'condition' | 'parallel' | 'human' | 'humanApproval' | 'dataQuery' | 'notification' | 'wait';

export type WorkflowOutputFormat = 'json' | 'markdown' | 'text';

export type WorkflowFailureMode = 'halt' | 'skip' | 'retry';

export interface WorkflowStep {
  id: string;
  title: string;
  description?: string;
  type: WorkflowStepType;
  agent?: string;
  input?: { from: 'trigger' | string };
  prompt?: string;
  template?: Record<string, string>;
  constraints?: {
    maxTokens?: number;
    temperature?: number;
    maxRetries?: number;
    persistent?: boolean;
    segmentId?: string;
    model?: string;
  };
  condition?: {
    expression: string;
    trueBranch: string;
    falseBranch: string;
  };
  approvalOptions?: {
    retryTarget?: string;
    actions: Array<'continue' | 'retry' | 'halt'>;
  };
  parallel?: {
    children: string[];
    aggregation?: 'all' | 'first' | 'merge';
  };
}

export interface WorkflowCapabilities {
  files?: { read?: boolean; write?: boolean };
  web?: { fetch?: boolean; http?: boolean };
  shell?: boolean;
  scheduler?: boolean;
  knowledge?: { search?: boolean; index?: boolean };
  evaluation?: boolean;
}

export interface WorkflowDefinition {
  name: string;
  description?: string;
  steps: WorkflowStep[];
  capabilities?: WorkflowCapabilities;
}

/** Legacy status values for persisted workflows. */
export type WorkflowStatus = 'draft' | 'active' | 'paused' | 'completed' | 'failed';

// ── Memory ──

export const MemoryLayer = {
  ShortTerm: 'short_term',
  LongTerm: 'long_term',
  Entity: 'entity',
  Project: 'project',
} as const;

export type MemoryLayer = (typeof MemoryLayer)[keyof typeof MemoryLayer];
