// Shared harness data hook — used by HarnessWidget and HarnessModal.
import { useState, useEffect, useCallback } from 'react';
import { apiFetch, authHeaders } from '../../utils/api.js';

export interface HarnessData {
  today: { toolPassRate: number; sessionSuccessRate: number; sessions: number };
  health: { toolHealth: string; contextHealth: string; successRate: number };
  trend: { date: string; toolSuccessRate: number; sessionSuccessRate: number }[];
  lastEscalation: { type: string; severity: string; description: string; timestamp: string } | null;
  recentActions?: Array<{ type: string; severity: string; description: string; requiresApproval: boolean; applied: boolean; timestamp: string }>;
}

export function useHarnessData() {
  const [data, setData] = useState<HarnessData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(() => {
    apiFetch('/api/harness/overview', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .catch((err) => { console.warn('Operation failed', err); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return { data, loading, fetchData };
}
