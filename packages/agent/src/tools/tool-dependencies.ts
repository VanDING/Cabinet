import type { EventBus } from '@cabinet/events';
import type {
  ShortTermMemory,
  LongTermMemory,
  EntityMemory,
  ProjectMemory,
  MemoryFacade,
} from '@cabinet/memory';
import type { DecisionStore, Decision } from '@cabinet/types';
import type { FileToolDeps } from './file-tools.js';
import type { WebToolDeps } from './web-tools.js';
import type { ShellToolDeps } from './shell-tools.js';
import type { SchedulerToolDeps } from './scheduler-tools.js';
import type { KnowledgeToolDeps } from './knowledge-tools.js';
import type { EvaluationToolDeps } from './evaluation-tools.js';
import type { LSPToolDeps } from './lsp-tools.js';
import type { SystemKnowledgeToolDeps } from './system-knowledge-tools.js';
import type { DocumentToolDeps } from './document-tools.js';
import type { ArchiveToolDeps } from './archive-tools.js';
import type { BrowserToolDeps } from './browser-tools.js';
import type { CommunicationToolDeps } from './communication-tools.js';
import type { SystemToolDeps } from './system-tools.js';

export interface ToolDependencies
  extends
    FileToolDeps,
    WebToolDeps,
    ShellToolDeps,
    SchedulerToolDeps,
    KnowledgeToolDeps,
    EvaluationToolDeps,
    LSPToolDeps,
    SystemKnowledgeToolDeps,
    DocumentToolDeps,
    ArchiveToolDeps,
    BrowserToolDeps,
    CommunicationToolDeps,
    SystemToolDeps {
  // ── Existing (read path) ──
  decisionStore: DecisionStore;
  eventBus: EventBus;
  /** @deprecated Use memoryFacade instead. Raw store access will be removed in a future release. */
  shortTerm: ShortTermMemory;
  /** @deprecated Use memoryFacade instead. */
  longTerm: LongTermMemory;
  /** @deprecated Use memoryFacade instead. */
  entity: EntityMemory;
  /** @deprecated Use memoryFacade instead. */
  project: ProjectMemory;
  /** Unified memory facade — preferred read/write entry point for memory tools. */
  memoryFacade: MemoryFacade;

  // ── Write callbacks (wired by server layer) ──
  createDecision: (input: {
    projectId: string;
    type: import('@cabinet/types').DecisionType;
    title: string;
    description: string;
    options: { id: string; label: string; impact: string }[];
    classification: {
      scopeDescription: string;
      isCrossSession: boolean;
      optionCount: number;
      estimatedCost: number;
      involvesFunds: boolean;
      involvesPermissions: boolean;
      involvesDataDeletion: boolean;
      involvesOrgConfig: boolean;
    };
    captainId?: string;
  }) => Decision;
  approveDecision: (decisionId: string, captainId: string, chosenOptionId: string) => Decision;
  rejectDecision: (decisionId: string, captainId: string) => Decision;

  listWorkflows: () => { id: string; name: string; status: string; stepCount: number }[];
  getWorkflow: (
    id: string,
  ) => { id: string; name: string; definition: unknown; status: string } | undefined;
  createWorkflow: (input: { name: string; projectId: string; definition: unknown }) => {
    id: string;
  };
  updateWorkflow: (id: string, input: { name?: string; definition?: unknown }) => void;
  deleteWorkflow: (id: string) => void;
  runWorkflow: (id: string) => Promise<{ runId: string; status: string; steps?: unknown[] }>;

  getWorkflowRun: (runId: string) => {
    runId: string;
    workflowId: string;
    status: string;
    steps: unknown[];
    startedAt: string;
    updatedAt: string;
  } | null;
  listWorkflowRuns: (workflowId: string) => Array<{
    runId: string;
    workflowId: string;
    status: string;
    startedAt: string;
    updatedAt: string;
  }>;

  writeLongTermMemory: (content: string, metadata?: Record<string, unknown>) => Promise<string>;
  createEmployee: (input: { name: string; role: string; kind: string }) => void;

  registerAgent: (input: {
    name: string;
    description: string;
    systemPrompt: string;
    modelTier: string;
    temperature: number;
    maxResponseTokens: number;
    allowedTools: string[];
    contextBudget: number;
  }) => { type: string; name: string };
  updateAgent: (name: string, updates: Record<string, unknown>) => void;
  deleteAgent: (name: string) => void;
  listAgents: () => { type: string; name: string; description: string; builtIn: boolean }[];
  invokeAgent: (
    agentName: string,
    message: string,
    callerSessionId?: string,
  ) => Promise<{ agentName: string; response: string }>;

  // Project tools
  setProjectContext: (projectId: string) => { id: string; name: string };
  createProject: (input: { name: string; description?: string; rootPath?: string }) => {
    id: string;
    name: string;
  };
  listProjects: () => {
    id: string;
    name: string;
    lastActivityAt?: string;
    activeWorkflowCount?: number;
  }[];
  getProjectContext: (projectId: string) => Record<string, unknown> | null;

  getDashboardStats: () => {
    pendingDecisions: number;
    activeWorkflows: number;
    activeProjects: number;
    todayCost: number;
    totalLLMCalls: number;
    totalTokens: number;
    totalDecisions: number;
    errors: number;
    recentEvents: { message: string; time: string }[];
  };

  delegateTask: (name: string, agentName?: string, description?: string) => string;
  getTaskStatus: (
    taskId: string,
  ) => { id: string; name: string; status: string; startTime?: number; endTime?: number } | null;
  listActiveTasks: () => { id: string; name: string; status: string }[];

  getDecisionAudit: (decisionId: string) => Array<{
    action: string;
    actor: string;
    changes: Record<string, unknown>;
    timestamp: string;
  }>;

  getSystemMetrics: () => {
    totalLLMCalls: number;
    totalTokens: number;
    totalDecisions: number;
    errors: number;
  };

  generateEmbeddings: (texts: string[]) => Promise<number[][]>;
}
