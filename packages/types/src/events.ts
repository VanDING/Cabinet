import type { BudgetPeriod } from './boundaries.js';

// ── MessageType ──

export const MessageType = {
  // 决策
  DecisionRequest: 'decision_request',
  DecisionResolved: 'decision_resolved',
  // 任务
  TaskOrder: 'task_order',
  TaskCompleted: 'task_completed',
  TaskFailed: 'task_failed',
  // 会议
  MeetingStarted: 'meeting_started',
  MeetingCompleted: 'meeting_completed',
  DeliberationProposal: 'deliberation_proposal',
  // 工作流
  WorkflowStarted: 'workflow_started',
  WorkflowStatusChanged: 'workflow_status_changed',
  WorkflowCompleted: 'workflow_completed',
  // Agent间通信
  AgentTaskAssigned: 'agent_task_assigned',
  AgentTaskCompleted: 'agent_task_completed',
  AgentContextRequested: 'agent_context_requested',
  AgentContextShared: 'agent_context_shared',
  // 秘书
  SecretaryMessage: 'secretary_message',
  GreetingGenerated: 'greeting_generated',
  // 系统
  BudgetAlert: 'budget_alert',
  QualityAlert: 'quality_alert',
  SystemNotification: 'system_notification',
  AuditEvent: 'audit_event',
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

// ── Payload Interfaces ──

export interface DecisionRequest {
  decisionId: string;
  title: string;
  level: string;
}

export interface DecisionResolved {
  decisionId: string;
  status: string;
  chosenOptionId: string;
}

export interface TaskOrder {
  orderId: string;
  action: string;
}

export interface TaskCompleted {
  orderId: string;
  result: Record<string, unknown>;
}

export interface TaskFailed {
  orderId: string;
  error: string;
}

export interface DeliberationProposal {
  meetingId: string;
  consensus: string;
  minorityReport?: string;
}

export interface WorkflowStarted {
  workflowId: string;
  projectId?: string;
}

export interface WorkflowStatusChanged {
  workflowId: string;
  runId: string;
  nodeId: string;
  status: string;
}

export interface WorkflowCompleted {
  workflowId: string;
  runId: string;
  status: string;
}

export interface SecretaryMessage {
  sessionId: string;
  content: string;
  role?: string;
}

export interface GreetingGenerated {
  sessionId: string;
  greeting: string;
}

export interface BudgetAlert {
  level: 'warning' | 'critical';
  currentSpend: number;
  limit: number;
  period: BudgetPeriod;
}

export interface QualityAlert {
  type: string;
  message: string;
  severity?: 'low' | 'medium' | 'high';
}

export interface SystemNotification {
  type: string;
  message?: string;
  data?: Record<string, unknown>;
}

export interface AuditEvent {
  entityType: string;
  entityId: string;
  action: string;
  actor?: string;
  changes?: Record<string, unknown>;
}

export interface MeetingStarted {
  meetingId: string;
  topic: string;
  advisorIds: string[];
  projectId?: string;
}

export interface MeetingCompleted {
  meetingId: string;
  topic: string;
  synthesis: string;
  perspectiveCount: number;
  reviewPassed: boolean;
  decisionId?: string;
}

export interface AgentTaskAssigned {
  agentId: string;
  taskId: string;
  request: string;
  sessionId: string;
  projectId?: string;
}

export interface AgentTaskCompleted {
  agentId: string;
  taskId: string;
  result: string;
  structuredOutput?: Record<string, unknown>;
  sessionId: string;
}

export interface AgentContextRequested {
  agentId: string;
  requestorId: string;
  contextKeys: string[];
  sessionId: string;
}

export interface AgentContextShared {
  agentId: string;
  recipientId: string;
  context: Record<string, unknown>;
  sessionId: string;
}

// ── Payload Map (MessageType → Payload) ──

export interface PayloadMap {
  [MessageType.DecisionRequest]: DecisionRequest;
  [MessageType.DecisionResolved]: DecisionResolved;
  [MessageType.TaskOrder]: TaskOrder;
  [MessageType.TaskCompleted]: TaskCompleted;
  [MessageType.TaskFailed]: TaskFailed;
  [MessageType.MeetingStarted]: MeetingStarted;
  [MessageType.MeetingCompleted]: MeetingCompleted;
  [MessageType.DeliberationProposal]: DeliberationProposal;
  [MessageType.WorkflowStarted]: WorkflowStarted;
  [MessageType.WorkflowStatusChanged]: WorkflowStatusChanged;
  [MessageType.WorkflowCompleted]: WorkflowCompleted;
  [MessageType.AgentTaskAssigned]: AgentTaskAssigned;
  [MessageType.AgentTaskCompleted]: AgentTaskCompleted;
  [MessageType.AgentContextRequested]: AgentContextRequested;
  [MessageType.AgentContextShared]: AgentContextShared;
  [MessageType.SecretaryMessage]: SecretaryMessage;
  [MessageType.GreetingGenerated]: GreetingGenerated;
  [MessageType.BudgetAlert]: BudgetAlert;
  [MessageType.QualityAlert]: QualityAlert;
  [MessageType.SystemNotification]: SystemNotification;
  [MessageType.AuditEvent]: AuditEvent;
}

// ── MessageEnvelope (discriminated union on messageType) ──

export type MessageEnvelope<T extends MessageType = MessageType> = {
  [K in T]: {
    readonly messageId: string;
    readonly correlationId: string;
    readonly causationId: string | null;
    readonly timestamp: Date;
    readonly messageType: K;
    readonly payload: PayloadMap[K];
    /** Optional expiry time. Events past this time may be cleaned up. */
    readonly expiresAt?: Date;
  };
}[T];
