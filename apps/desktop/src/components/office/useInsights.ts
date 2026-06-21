// Shared insights data hook — used by InsightsWidget and InsightsModal.
import { useState, useEffect, useCallback } from 'react';
import { apiFetch, authHeaders } from '../../utils/api.js';

export interface Insight {
  id: string;
  text: string;
  relevance: number;
  relatedEntities: string[];
  timestamp: string;
}

export function useInsights() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInsights = useCallback(() => {
    apiFetch('/api/insights', { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => {
        if (data.insights) setInsights(data.insights);
      })
      .catch((err) => {
        console.warn('Operation failed', err);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  const latest = insights.slice(0, 3);

  return { insights, loading, latest, fetchInsights };
}
