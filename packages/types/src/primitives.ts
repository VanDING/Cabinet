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

export interface ProjectContext {
  projectId: string;
  summary: string;
  goals: string[];
  constraints: Record<string, unknown>;
  techSummary: string;
  riskMap: unknown[];
  keyDecisions: unknown[];
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

export type WorkflowStepType = 'aiAgent' | 'humanApproval' | 'condition' | 'notification' | 'dataQuery' | 'wait';

export type WorkflowOutputFormat = 'json' | 'markdown' | 'text';

export type WorkflowFlowMode = 'sequential' | 'conditional' | 'parallel';

export type WorkflowFailureMode = 'halt' | 'skip' | 'retry';

export interface WorkflowStep {
  id: string;
  title: string;
  /** Human-readable description of what this step does. */
  description: string;
  type: WorkflowStepType;
  /** Reference to a registered Agent role (aiAgent steps). */
  agent?: string;
  /** Where this step gets its input. */
  input?: {
    from: 'trigger' | string;
    schema?: Record<string, unknown>;
  };
  /** What this step produces. */
  output?: {
    format: WorkflowOutputFormat;
    schema?: Record<string, unknown>;
  };
  /** Step-specific instruction. Supports {{variable}} template syntax. */
  prompt?: string;
  constraints?: {
    maxTokens?: number;
    temperature?: number;
    maxRetries?: number;
  };
  /** Condition branching (condition type only). */
  condition?: {
    expression: string;
    trueBranch: string;
    falseBranch: string;
  };
  /** Human approval options (humanApproval type only). */
  approvalOptions?: Array<{
    label: string;
    action: 'continue' | 'retry' | 'halt';
    target?: string;
  }>;
}

export interface WorkflowDefinition {
  name: string;
  description?: string;
  version: number;
  config?: {
    projectId?: string;
    requireApproval?: boolean;
  };
  steps: WorkflowStep[];
  flow?: WorkflowFlowMode;
  onFailure?: WorkflowFailureMode;
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
