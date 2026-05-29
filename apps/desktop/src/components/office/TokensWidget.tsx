import { useState, useEffect, useCallback } from 'react';
import { apiFetch, authHeaders } from '../../utils/pin.js';

interface TokenPoint {
  date: string;
  tokens: number;
}

export function TokensWidget() {
  const [totalTokens, setTotalTokens] = useState<number | null>(null);
  const [todayTokens, setTodayTokens] = useState<number | null>(null);

  const fetchTokens = useCallback(() => {
    apiFetch('/api/dashboard/cost-history?days=7', { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => {
        const history: TokenPoint[] = data.history ?? [];
        const total = history.reduce((s: number, h: TokenPoint) => s + (h.tokens ?? 0), 0);
        const today = history.length > 0 ? (history[history.length - 1]?.tokens ?? 0) : 0;
        setTotalTokens(total);
        setTodayTokens(today);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  useEffect(() => {
    window.addEventListener('ws:cost_updated', fetchTokens);
    window.addEventListener('ws:secretary_message', fetchTokens);
    return () => {
      window.removeEventListener('ws:cost_updated', fetchTokens);
      window.removeEventListener('ws:secretary_message', fetchTokens);
    };
  }, [fetchTokens]);

  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-surface-primary p-4 shadow-sm">
      <div className="mb-3 text-sm font-medium text-content-secondary">Tokens</div>
      {totalTokens === null ? (
        <div className="flex flex-1 items-center justify-center text-xs text-content-tertiary">
          Loading...
        </div>
      ) : (
        <div className="flex-1 space-y-3">
          <div>
            <div className="text-2xl font-bold text-content-primary">
              {fmt(todayTokens ?? 0)}
            </div>
            <div className="text-xs text-content-tertiary">Today</div>
          </div>
          <div>
            <div className="text-sm font-medium text-content-secondary">
              {fmt(totalTokens)}
            </div>
            <div className="text-xs text-content-tertiary">This week</div>
          </div>
        </div>
      )}
    </div>
  );
}
