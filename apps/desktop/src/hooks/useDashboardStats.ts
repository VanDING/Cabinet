import { useQuery } from '@tanstack/react-query';
import { apiFetch, authHeaders } from '../utils/api.js';

interface CostEntry {
  date: string;
  cost_usd: number;
  tokens: number;
}

interface DashboardStats {
  history: CostEntry[];
  totalCost: number;
  totalTokens: number;
}

export function useDashboardStats() {
  return useQuery<DashboardStats>({
    queryKey: ['dashboard', 'cost-history'],
    queryFn: async () => {
      const res = await apiFetch('/api/dashboard/cost-history?days=30', { headers: authHeaders() });
      if (!res.ok) throw new Error('Failed to load dashboard stats');
      return res.json();
    },
  });
}
