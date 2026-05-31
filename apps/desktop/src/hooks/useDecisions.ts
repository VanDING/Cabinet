import { useQuery } from '@tanstack/react-query';
import { apiFetch, authHeaders } from '../utils/pin.js';
import type { Decision } from '@cabinet/types';

export function useDecisions(projectId?: string | null) {
  return useQuery<Decision[]>({
    queryKey: ['decisions', projectId ?? 'global'],
    queryFn: async () => {
      const params = new URLSearchParams({ status: 'all' });
      if (projectId) params.set('projectId', projectId);
      const res = await apiFetch(`/api/decisions?${params.toString()}`, { headers: authHeaders() });
      if (!res.ok) throw new Error('Failed to load decisions');
      const data = await res.json();
      return (data.decisions ?? []) as Decision[];
    },
  });
}
