import { useQuery } from '@tanstack/react-query';
import type { DashboardStats, DashboardCostHistory } from '@cabinet/types';
import { apiFetch, authHeaders } from '../utils/api.js';

interface DashboardData extends DashboardStats {
  costHistory?: DashboardCostHistory;
}

export function useDashboardStats() {
  return useQuery<DashboardData>({
    queryKey: ['dashboard', 'stats'],
    queryFn: async () => {
      const [summaryRes, costRes] = await Promise.all([
        apiFetch('/api/dashboard/summary', { headers: authHeaders() }),
        apiFetch('/api/dashboard/cost-history?days=30', { headers: authHeaders() }),
      ]);

      if (!summaryRes.ok) throw new Error('Failed to load dashboard summary');
      if (!costRes.ok) throw new Error('Failed to load cost history');

      const summary = (await summaryRes.json()) as DashboardStats;
      const costHistory = (await costRes.json()) as DashboardCostHistory;

      return { ...summary, costHistory };
    },
    staleTime: 10_000, // 10 seconds — matches server cache TTL
  });
}
