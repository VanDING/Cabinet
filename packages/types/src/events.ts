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
  // 秘书
  SecretaryMessage: 'secretary_message',
  GreetingGenerated: 'greeting_generated',
  // 系统
  BudgetAlert: 'budget_alert',
  SystemNotification: 'system_notification',
  AuditEvent: 'audit_event',
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

// ── MessageEnvelope ──

export interface MessageEnvelope {
  readonly messageId: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly timestamp: Date;
  readonly messageType: MessageType;
  readonly payload: Record<string, unknown>;
}

// ── Payload Types ──

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

export interface WorkflowStatusChanged {
  workflowId: string;
  runId: string;
  nodeId: string;
  status: string;
}

export interface BudgetAlert {
  level: 'warning' | 'critical';
  currentSpend: number;
  limit: number;
  period: 'daily' | 'weekly' | 'monthly';
}
