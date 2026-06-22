// ── Structured Output types for AI chat ──

export type StructuredOutputType =
  | 'decision_proposal'
  | 'deliverable'
  | 'status_report'
  | 'task_list'
  | 'workflow_result';

export interface DecisionProposalData {
  title: string;
  priority: 'high' | 'medium' | 'low';
  recommendation: string;
  summary: string;
  dimensions: string[];
  options: Array<{
    label: string;
    scores: Record<string, number>;
    notes?: string;
  }>;
}

export interface DeliverableData {
  title: string;
  summary: string;
  fullContent: string;
  generationTimeMs?: number;
  sources?: string[];
  status: 'pending_review' | 'approved' | 'rejected';
}

export interface StatusReportData {
  todayCost: number;
  activeAgents: number;
  activeWorkflows: number;
  health: 'healthy' | 'degraded' | 'error';
  runningWorkflows: Array<{
    name: string;
    currentNode: string;
    progress: string;
  }>;
  alerts: Array<{
    message: string;
    time: string;
  }>;
}

export interface TaskItem {
  id: string;
  title: string;
  dueBy?: string;
  assignee: string;
  status: 'pending' | 'running' | 'done';
}

export interface TaskListData {
  title: string;
  tasks: TaskItem[];
}

export interface WorkflowResultData {
  workflowName: string;
  trigger: string;
  success: boolean;
  durationMs: number;
  nodeResults: Array<{
    type: string;
    status: 'success' | 'error' | 'warning';
    details?: string;
  }>;
  alerts: Array<{
    severity: string;
    message: string;
  }>;
}

export interface StructuredOutput {
  id: string;
  type: StructuredOutputType;
  data: Record<string, unknown>;
  status: 'proposed' | 'accepted' | 'rejected' | 'modified' | 'info';
  timestamp: number;
}
