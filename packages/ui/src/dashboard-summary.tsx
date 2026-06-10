import type { DashboardStats, DashboardAgentStatus } from '@cabinet/types';
import { CountUp } from './animations/CountUp';

export type { DashboardStats } from '@cabinet/types';

export interface DashboardSummaryProps {
  stats: DashboardStats;
  onNavigate?: (page: 'cabinet' | 'office' | 'factory') => void;
}

function AgentStatusCard({ agents }: { agents?: DashboardAgentStatus[] }) {
  if (!agents || agents.length === 0) return null;

  const statusColor: Record<DashboardAgentStatus['status'], string> = {
    online: 'bg-intent-success',
    offline: 'bg-intent-danger',
    busy: 'bg-intent-warning',
    error: 'bg-intent-danger',
    unknown: 'bg-intent-neutral',
  };

  return (
    <div className="rounded-lg border border-border bg-surface-primary p-4 shadow-xs">
      <h2 className="mb-3 font-semibold text-content-primary">Agent Status</h2>
      <div className="space-y-2">
        {agents.map((agent) => (
          <div key={agent.id} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${statusColor[agent.status]}`} />
              <span className="text-content-secondary">{agent.name}</span>
              <span className="text-content-tertiary text-xs">({agent.type})</span>
            </div>
            <span className="text-content-tertiary capitalize">{agent.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardSummary({ stats, onNavigate }: DashboardSummaryProps) {
  const cards: Array<{
    label: string;
    value: number | string;
    numericValue: number | null;
    color: string;
    target: 'office' | 'factory' | null;
    prefix?: string;
  }> = [
    {
      label: 'Pending Decisions',
      value: stats.pendingDecisions,
      numericValue: stats.pendingDecisions,
      color: 'text-intent-warning',
      target: 'office',
    },
    {
      label: "Today's Cost",
      value: `${stats.todayCost.toFixed(2)}`,
      numericValue: stats.todayCost,
      color: 'text-accent',
      target: null,
      prefix: '$',
    },
    {
      label: 'Active Projects',
      value: stats.activeProjects,
      numericValue: stats.activeProjects,
      color: 'text-intent-success',
      target: null,
    },
    {
      label: 'Workflows',
      value: stats.activeWorkflows,
      numericValue: stats.activeWorkflows,
      color: 'text-intent-purple',
      target: 'factory',
    },
  ];

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="mb-1 text-2xl font-bold text-content-primary">Dashboard</h1>
        <p className="text-content-tertiary">{stats.greeting ?? 'Welcome back.'}</p>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            onClick={() => card.target && onNavigate?.(card.target)}
            className={`rounded-lg border border-border bg-surface-primary p-4 shadow-xs ${card.target ? 'cursor-pointer transition-shadow hover:shadow-md' : ''}`}
          >
            <div className={`text-2xl font-bold ${card.color}`}>
              {card.numericValue != null ? (
                <CountUp
                  to={card.numericValue}
                  duration={0.8}
                  prefix={card.prefix}
                  separator=","
                />
              ) : (
                card.value
              )}
            </div>
            <div className="mt-1 text-sm text-content-tertiary">{card.label}</div>
          </div>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface-primary p-4 shadow-xs">
          <h2 className="mb-3 font-semibold text-content-primary">Recent Events</h2>
          {stats.recentEvents.length === 0 ? (
            <p className="text-sm text-content-tertiary">No recent events.</p>
          ) : (
            <div className="space-y-2">
              {stats.recentEvents.map((event, i) => (
                <div
                  key={i}
                  className="flex justify-between border-b border-border pb-1.5 text-sm last:border-0 last:pb-0"
                >
                  <span className="text-content-secondary">{event.message}</span>
                  <span className="text-content-tertiary">
                    {new Date(event.time).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <AgentStatusCard agents={stats.agents} />
      </div>
    </div>
  );
}
