export interface DashboardStats {
  pendingDecisions: number;
  todayCost: number;
  activeProjects: number;
  activeWorkflows: number;
  recentEvents: { message: string; time: Date }[];
  greeting: string;
}

export interface DashboardSummaryProps {
  stats: DashboardStats;
  onNavigate?: (page: 'cabinet' | 'office' | 'factory') => void;
}

export function DashboardSummary({ stats, onNavigate }: DashboardSummaryProps) {
  const cards = [
    {
      label: 'Pending Decisions',
      value: stats.pendingDecisions,
      color: 'text-amber-600',
      target: 'office' as const,
    },
    {
      label: "Today's Cost",
      value: `${stats.todayCost.toFixed(2)}`,
      color: 'text-blue-600',
      target: null,
    },
    {
      label: 'Active Projects',
      value: stats.activeProjects,
      color: 'text-green-600',
      target: null,
    },
    {
      label: 'Workflows',
      value: stats.activeWorkflows,
      color: 'text-purple-600',
      target: 'factory' as const,
    },
  ];

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="mb-1 text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500">{stats.greeting}</p>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            onClick={() => card.target && onNavigate?.(card.target)}
            className={`rounded-lg border bg-white p-4 ${card.target ? 'cursor-pointer transition-shadow hover:shadow-md' : ''}`}
          >
            <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
            <div className="mt-1 text-sm text-gray-500">{card.label}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border bg-white p-4">
        <h2 className="mb-3 font-semibold text-gray-800">Recent Events</h2>
        {stats.recentEvents.length === 0 ? (
          <p className="text-sm text-gray-400">No recent events.</p>
        ) : (
          <div className="space-y-2">
            {stats.recentEvents.map((event, i) => (
              <div
                key={i}
                className="flex justify-between border-b pb-1.5 text-sm last:border-0 last:pb-0"
              >
                <span className="text-gray-700">{event.message}</span>
                <span className="text-gray-400">
                  {event.time.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
