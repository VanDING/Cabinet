// ── Organization ──

export interface Organization {
  readonly id: string;
  name: string;
  captainId: string;
  createdAt: Date;
}

// ── Project ──

export const ProjectStatus = {
  Draft: 'draft',
  Active: 'active',
  Archived: 'archived',
} as const;

export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

export interface Project {
  readonly id: string;
  organizationId: string;
  name: string;
  description: string;
  status: ProjectStatus;
  createdAt: Date;
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

// ── Workflow ──

export interface WorkflowNode {
  id: string;
  type: 'skill' | 'condition' | 'parallel' | 'human';
  skillId?: string;
  condition?: string;
  title?: string;
  children?: string[];
  position: { x: number; y: number };
}

export interface WorkflowEdge {
  from: string;
  to: string;
  condition?: string;
}

export type WorkflowStatus = 'draft' | 'active' | 'paused' | 'completed' | 'failed';

export interface WorkflowDefinition {
  readonly id: string;
  projectId: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  entryNodeId: string;
  status: WorkflowStatus;
  createdAt: Date;
}

// ── Memory ──

export const MemoryLayer = {
  ShortTerm: 'short_term',
  LongTerm: 'long_term',
  Entity: 'entity',
  Project: 'project',
} as const;

export type MemoryLayer = (typeof MemoryLayer)[keyof typeof MemoryLayer];
