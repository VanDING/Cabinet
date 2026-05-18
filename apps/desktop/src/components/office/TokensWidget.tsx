import { useState, useEffect } from 'react';
import { apiFetch, authHeaders } from '../../utils/pin.js';

interface TokenPoint { date: string; tokens: number; }

export function TokensWidget() {
  const [totalTokens, setTotalTokens] = useState<number | null>(null);
  const [todayTokens, setTodayTokens] = useState<number | null>(null);

  useEffect(() => {
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

  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

  return (
    <div className="flex h-full flex-col rounded-lg border bg-white p-4 dark:border-gray-600 dark:bg-gray-800">
      <div className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">Tokens</div>
      {totalTokens === null ? (
        <div className="flex flex-1 items-center justify-center text-xs text-gray-400">Loading...</div>
      ) : (
        <div className="flex-1 space-y-3">
          <div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{fmt(todayTokens ?? 0)}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Today</div>
          </div>
          <div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{fmt(totalTokens)}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">This week</div>
          </div>
        </div>
      )}
    </div>
  );
}
