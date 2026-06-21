// Shared cost history data hook — used by CostChart and CostOverviewModal.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiFetch, authHeaders } from '../../utils/api.js';

export interface HistoryPoint {
  date: string;
  cost: number;
  tokens: number;
}

export type Period = 'daily' | 'weekly' | 'monthly';

export function formatTokens(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatCost(n: number): string {
  return n.toFixed(2);
}

export function useCostHistory() {
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('daily');

  const fetchData = useCallback(() => {
    apiFetch('/api/dashboard/cost-history?days=30', { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => {
        if (data.history) setHistory(data.history);
      })
      .catch((err) => {
        console.warn('Operation failed', err);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const costSubtotal = useMemo(() => {
    if (history.length === 0) return 0;
    if (period === 'daily') return history[history.length - 1]!.cost;
    if (period === 'weekly') return history.slice(-7).reduce((s, h) => s + h.cost, 0);
    return history.reduce((s, h) => s + h.cost, 0);
  }, [history, period]);

  const tokenSubtotal = useMemo(() => {
    if (history.length === 0) return 0;
    if (period === 'daily') return history[history.length - 1]!.tokens;
    if (period === 'weekly') return history.slice(-7).reduce((s, h) => s + h.tokens, 0);
    return history.reduce((s, h) => s + h.tokens, 0);
  }, [history, period]);

  const chartData = useMemo(() => {
    return history.slice(-7).map((h) => ({
      date: new Date(h.date).toLocaleDateString('en-US', { weekday: 'short' }),
      cost: h.cost,
      tokens: h.tokens,
    }));
  }, [history]);

  return { history, loading, period, setPeriod, fetchData, costSubtotal, tokenSubtotal, chartData };
}
