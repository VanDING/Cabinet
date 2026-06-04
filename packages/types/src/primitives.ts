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
  /** Names of other skills this skill depends on. */
  dependencies?: string[];
}

// ── Workflow (Unified node types — engine = canvas) ──

export type WorkflowNodeType =
  // Flow control (7)
  | 'start' | 'end'
  | 'ifElse' | 'loop' | 'parallel' | 'merge' | 'pass'
  // Container (1)
  | 'agentGroup'
  // Execution (5)
  | 'llm' | 'skill' | 'tool' | 'code' | 'workflow'
  // AI (2)
  | 'intentClassify' | 'knowledgeBase'
  // Human-in-the-loop (2)
  | 'approval' | 'human';

/** @deprecated Use WorkflowNodeType directly. Kept for backward compat. */
export type WorkflowStepType = WorkflowNodeType;

export interface WorkflowNodeDef {
  id: string;
  type: WorkflowNodeType;
  title?: string;
  description?: string;

  // ── Agent node config (unified — any agent source) ──
  /** Agent identifier — references any agent in AgentRoleRegistry (secretary, curator, claude-code-v1, etc.). */
  agentId?: string;
  // ── AgentGroup config ──
  /** Agent role name (secretary, curator, etc.) */
  role?: string;
  /** Override the role's system prompt */
  systemPrompt?: string;
  /** Model tier override */
  model?: string;
  /** AgentLoop persistence across group boundary */
  persistent?: boolean;
  /** Allowed tool names */
  allowedTools?: string[];
  /** Nodes inside this agentGroup */
  children?: WorkflowNodeDef[];

  // ── LLM / Agent config ──
  prompt?: string;
  temperature?: number;
  maxTokens?: number;
  outputFormat?: 'text' | 'json' | 'markdown';

  // ── Skill / Tool config ──
  skillId?: string;
  toolId?: string;
  /** Map input fields to Skill/Tool params */
  inputMapping?: Record<string, string>;

  // ── Code config ──
  code?: string;
  codeTimeout?: number;

  // ── Workflow ref ──
  workflowId?: string;

  // ── If-else config ──
  branches?: Array<{
    label: string;
    conditions: Array<{
      field: string;
      operator: string;
      value: string;
      logic: 'AND' | 'OR';
    }>;
    priority: number;
  }>;
  defaultBranch?: string;

  // ── Loop config ──
  loopType?: 'count' | 'condition';
  loopCount?: number;
  loopCondition?: string;
  loopMaxIterations?: number;
  loopOutputMode?: 'array' | 'last' | 'merge';

  // ── Parallel config ──
  waitStrategy?: 'all' | 'first';
  failStrategy?: 'failAll' | 'continue';

  // ── Merge / Pass config ──
  mergeStrategy?: 'object' | 'array' | 'concat' | 'firstNotNull';
  mergeTimeout?: number;

  // ── Intent Classify config ──
  intents?: Array<{
    name: string;
    description: string;
    examples?: string[];
  }>;
  intentThreshold?: number;

  // ── Knowledge Base config ──
  kbId?: string;
  queryTemplate?: string;
  topK?: number;
  scoreThreshold?: number;

  // ── Approval / Human config ──
  approvalTitle?: string;
  options?: string[];
  outputSchema?: Record<string, unknown>;
  humanDeadline?: string;

  // ── Generic I/O ──
  input?: { source: 'previous' | 'named' | 'none'; mapping?: Record<string, string> };
  output?: { schema?: Record<string, string>; passThrough?: boolean };
  /** Variable name for referencing this node's output */
  outputAs?: string;

  // Extra
  data?: Record<string, unknown>;
}

/** @deprecated Use WorkflowNodeDef. Kept for backward compat. */
export interface WorkflowStep {
  id: string;
  title: string;
  description?: string;
  type: WorkflowNodeType;
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

// ── Context Slot ──

/** Task-level shared data bus — Agent nodes read from & write to this. */
export interface ContextSlot {
  project: {
    name: string;
    tech_stack?: string;
    goals: string[];
    constraints?: Record<string, unknown>;
  };
  memories: string[];
  preferences: {
    riskTolerance?: 'low' | 'medium' | 'high';
    preferredDecisionStyle?: 'consensus' | 'directive' | 'analytical';
    [key: string]: unknown;
  };
  files: string[];
  discoveries: Array<{ type: string; summary: string; [key: string]: unknown }>;
  previous_outputs: string[];
  deliverable?: unknown;
  security: {
    level: string;
    tier?: string;
    maxRetries: number;
  };
}

// ── External Agent ──

/** How an external Agent's model/API configuration is managed. */
export type AgentConfigSource = 'cabinet_managed' | 'agent_native';

/** Protocol used to communicate with an external Agent. */
export type ExternalAgentProtocol = 'a2a' | 'cli';

/** Configuration for an external Agent (A2A or CLI). */
export interface ExternalAgentConfig {
  protocol: ExternalAgentProtocol;
  configSource: AgentConfigSource;
  // A2A
  baseUrl?: string;
  healthCheckUrl?: string;
  authConfig?: { type: 'api_key' | 'oauth'; header?: string; envVar?: string };
  // CLI
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  permissionMode?: 'auto' | 'conservative';
  detectCommand?: string;
  installCommand?: string;
  // General
  timeoutMs?: number;
  maxRetries?: number;
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

/** Lifecycle status for a workflow definition. */
export type WorkflowDefinitionStatus = 'draft' | 'active' | 'paused' | 'completed' | 'failed';

// ── Memory ──

export const MemoryLayer = {
  ShortTerm: 'short_term',
  LongTerm: 'long_term',
  Entity: 'entity',
  Project: 'project',
} as const;

export type MemoryLayer = (typeof MemoryLayer)[keyof typeof MemoryLayer];
