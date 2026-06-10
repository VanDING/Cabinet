// ── Dashboard Types ──

/** A single recent event displayed on the dashboard. */
export interface DashboardEvent {
  message: string;
  type: string;
  time: Date;
}

/** Budget status snapshot for dashboard display. */
export interface DashboardBudgetStatus {
  daily: number;
  weekly: number;
  monthly: number;
}

/** Summary data returned by GET /api/dashboard/summary. */
export interface DashboardSummary {
  pendingDecisions: number;
  todayCost: number;
  activeProjects: number;
  activeWorkflows: number;
  recentEvents: DashboardEvent[];
  budgetStatus: DashboardBudgetStatus;
  summary: Record<string, unknown>;
}

/** A single day's cost history entry. */
export interface DashboardCostEntry {
  date: string;
  cost: number;
  calls: number;
  tokens: number;
  byModel: Record<string, number>;
}

/** Cost history data returned by GET /api/dashboard/cost-history. */
export interface DashboardCostHistory {
  history: DashboardCostEntry[];
  dailyCost: number;
  budgetStatus: DashboardBudgetStatus;
  limits: { daily: number; weekly: number; monthly: number };
}

/** Agent health status for dashboard display. */
export interface DashboardAgentStatus {
  id: string;
  name: string;
  type: 'internal' | 'external' | 'daemon';
  status: 'online' | 'offline' | 'busy' | 'error';
  lastHeartbeatAt?: Date;
  activeTasks?: number;
  queueDepth?: number;
}

/** Combined dashboard stats for frontend consumption. */
export interface DashboardStats extends DashboardSummary {
  greeting?: string;
  costHistory?: DashboardCostHistory;
  agents?: DashboardAgentStatus[];
}
