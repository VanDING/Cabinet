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

// ── Workflow (Unified node types — engine = canvas) ──

export type WorkflowNodeType =
  // Flow control (9)
  | 'start'
  | 'end'
  | 'ifElse'
  | 'loop'
  | 'parallel'
  | 'merge'
  | 'pass'
  | 'notification'
  | 'wait'
  // Container (2)
  | 'agentGroup'
  | 'manager'
  // Execution (5)
  | 'llm'
  | 'skill'
  | 'tool'
  | 'code'
  | 'workflow'
  // AI (2)
  | 'intentClassify'
  | 'knowledgeBase'
  // Human-in-the-loop (2)
  | 'approval'
  | 'human'
  // External agent dispatch
  | 'externalAgent';

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
  /** Squad ID — when set, this agentGroup acts as a Squad with team routing */
  squadId?: string;

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
  /** When true, await sub-workflow completion. When false (default), fire-and-forget. */
  synchronous?: boolean;

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
  output?: {
    schema?: Record<string, string>;
    passThrough?: boolean;
    /** Role of this node's output in data lineage. */
    role?: 'intermediate' | 'final' | 'passthrough';
  };
  /** Variable name for referencing this node's output */
  outputAs?: string;

  // ── Error handling ──
  /** What to do when this node fails after retries are exhausted. */
  onError?: 'stop' | 'continue';
  /** Workflow ID to trigger as error recovery when this node causes the run to fail. */
  errorTriggerWorkflowId?: string;

  // ── Manager config ──
  managerConfig?: {
    /** Maximum planning→dispatch→review rounds. */
    maxRounds?: number;
    /** Instructions for the manager's planning phase. */
    planningPrompt?: string;
    /** Instructions for the review/evaluation phase. */
    reviewPrompt?: string;
    /** Whether the manager can delegate to a Squad for team routing. */
    squadDelegation?: boolean;
  };

  // Extra
  data?: Record<string, unknown>;
}

// ── Context Slot ──

/** Task-level shared data bus — Agent nodes read from & write to this. */
export interface ContextSlot {
  /** Monotonic version for optimistic concurrency. Incremented on every write. */
  version: number;
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
  /** Skills bound to this agent (names) */
  skills?: string[];
  /** MCP server names bound to this agent */
  mcpServers?: string[];
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
  dispatchProtocol?: 'acp' | 'headless' | 'terminal-only';
  nativeConfigPaths?: { win32: string[]; darwin: string[]; linux: string[] };
  sdkPackage?: string;
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

// ── Structured Data Flow (M1 Data Plane) ─────────────────────────

/** A node's declaration of what it produces and its role in the data pipeline. */
export interface NodeOutputContract {
  /** Field name → expected type. */
  schema?: Record<string, 'string' | 'number' | 'boolean' | 'json' | 'file'>;
  /** Role in data lineage: intermediate (feeds children), final (end result), passthrough (no change). */
  role?: 'intermediate' | 'final' | 'passthrough';
}

/** A single step record within a WorkflowRun — extends the legacy {output} shape. */
export interface WorkflowRunStep {
  nodeId: string;
  type: WorkflowNodeType;
  /** Plain-text output (always populated, backward compatible). */
  output: string;
  /** Structured data items parsed according to the node's output contract. */
  items?: unknown[];
  /** Data lineage: which upstream node+step produced the input for this step. */
  pairedItem?: {
    sourceNodeId: string;
    sourceStepIndex: number;
  };
  /** The output contract that was active when this step executed. */
  contract?: NodeOutputContract;
}

/**
 * Structured input passed to a node at execution time.
 * Replaces simple string concatenation with typed, traceable upstream data.
 */
export interface StructuredInput {
  /** Full concatenated previous outputs (backward compatible). */
  previousOutputs: string;
  /** Structured history from upstream nodes that feed into this node. */
  upstreamItems: {
    nodeId: string;
    type: WorkflowNodeType;
    items: unknown[];
    contract?: NodeOutputContract;
    pairedItem?: { sourceNodeId: string; sourceStepIndex: number };
  }[];
}

// ── Daemon / Task Queue ──

export type TaskQueueStatus =
  | 'pending'
  | 'claimed'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TaskProgress {
  percent: number;
  message: string;
  step: number;
}

export interface TaskQueueEntry {
  id: string;
  agentId: string;
  sessionId: string;
  capability: string;
  input: unknown;
  slot: ContextSlot;
  status: TaskQueueStatus;
  priority: number;
  retryCount: number;
  maxRetries: number;
  timeoutMs: number;
  claimedBy: string | null;
  claimedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  progress: TaskProgress;
  errorMessage: string | null;
  output: unknown | null;
  cronExpression: string | null;
  webhookUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DaemonStatus {
  daemonId: string;
  status: 'online' | 'degraded' | 'offline';
  uptimeMs: number;
  activeTaskCount: number;
  completedTaskCount: number;
  failedTaskCount: number;
  agents: DaemonAgentInfo[];
  orphanPorts?: number[];
}

export interface DaemonAgentInfo {
  agentId: string;
  command: string;
  detected: boolean;
  status: 'online' | 'offline';
  activeTaskCount: number;
  lastHeartbeatAt: string | null;
  cpuPercent?: number;
  memoryMb?: number;
  openPorts?: number[];
  pid?: number;
}
