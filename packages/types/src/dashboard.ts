// ── Dashboard types (API response contracts) ──

export interface DashboardBudgetStatus {
  daily: number;
  weekly: number;
  monthly: number;
}

export interface DashboardSummary {
  pendingDecisions: number;
  todayCost: number;
  activeProjects: number;
  activeWorkflows: number;
  recentEvents: Array<{ message: string; type: string; time: Date }>;
  budgetStatus: DashboardBudgetStatus;
  summary: Record<string, unknown>;
}

export interface DashboardCostHistory {
  history: Array<{
    date: string;
    cost: number;
    calls: number;
    tokens: number;
    byModel: Record<string, unknown>;
  }>;
  dailyCost: number;
  budgetStatus: { daily: number; weekly: number; monthly: number };
  limits: { daily: number; weekly: number; monthly: number };
}

export type DashboardAgentType = 'internal' | 'external' | 'daemon';
export type DashboardAgentStatusValue = 'online' | 'offline' | 'error' | 'unknown';

export interface DashboardAgentStatus {
  id: string;
  name: string;
  type: DashboardAgentType;
  status: DashboardAgentStatusValue;
  lastHeartbeatAt?: Date;
  activeTasks?: number;
}

export interface DashboardTrendEntry {
  date: string;
  decisions: number;
  workflows: number;
  errors: number;
  tasks: number;
  sessions: number;
}
