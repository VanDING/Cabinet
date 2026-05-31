import { useQuery } from '@tanstack/react-query';
import { apiFetch, authHeaders } from '../utils/pin.js';

export interface Deliverable {
  id: string;
  projectId: string;
  title: string;
  type: string;
  filePath?: string;
  meetingId?: string;
  tags: string[];
  createdAt: string;
}

export function useDeliverables(projectId?: string | null) {
  return useQuery<Deliverable[]>({
    queryKey: ['deliverables', projectId ?? 'global'],
    queryFn: async () => {
      const url = projectId ? `/api/projects/${projectId}/deliverables` : '/api/deliverables';
      const res = await apiFetch(url, { headers: authHeaders() });
      if (!res.ok) throw new Error('Failed to load deliverables');
      const data = await res.json();
      return (data.deliverables ?? []) as Deliverable[];
    },
  });
}
