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
    { label: 'Pending Decisions', value: stats.pendingDecisions, color: 'text-amber-600', target: 'office' as const },
    { label: "Today's Cost", value: `$${stats.todayCost.toFixed(2)}`, color: 'text-blue-600', target: null },
    { label: 'Active Projects', value: stats.activeProjects, color: 'text-green-600', target: null },
    { label: 'Workflows', value: stats.activeWorkflows, color: 'text-purple-600', target: 'factory' as const },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Dashboard</h1>
        <p className="text-gray-500">{stats.greeting}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map(card => (
          <div
            key={card.label}
            onClick={() => card.target && onNavigate?.(card.target)}
            className={`bg-white border rounded-lg p-4 ${card.target ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
          >
            <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
            <div className="text-sm text-gray-500 mt-1">{card.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border rounded-lg p-4">
        <h2 className="font-semibold text-gray-800 mb-3">Recent Events</h2>
        {stats.recentEvents.length === 0 ? (
          <p className="text-sm text-gray-400">No recent events.</p>
        ) : (
          <div className="space-y-2">
            {stats.recentEvents.map((event, i) => (
              <div key={i} className="flex justify-between text-sm border-b last:border-0 pb-1.5 last:pb-0">
                <span className="text-gray-700">{event.message}</span>
                <span className="text-gray-400">{event.time.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
