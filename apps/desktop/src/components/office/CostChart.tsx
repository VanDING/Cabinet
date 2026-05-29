import { useState, useEffect, useCallback } from 'react';
import { apiFetch, authHeaders } from '../../utils/pin.js';

interface CostPoint {
  date: string;
  cost: number;
  calls: number;
  byModel: Record<string, number>;
}

interface BudgetInfo {
  daily: number;
  weekly: number;
  monthly: number;
}

interface Limits {
  daily: number;
  weekly: number;
  monthly: number;
}

const MODEL_COLORS: Record<string, string> = {
  'claude-haiku-4-5': '#10B981',
  'claude-sonnet-4-6': '#3B82F6',
  'claude-opus-4-7': '#8B5CF6',
  'gpt-4o': '#F59E0B',
  'gpt-4o-mini': '#FBBF24',
  'gpt-4-turbo': '#EF4444',
  'deepseek-chat': '#06B6D4',
  'deepseek-v3': '#14B8A6',
  'deepseek-r1': '#6366F1',
  'gemini-2.0-flash': '#EC4899',
  'gemini-2.0-pro': '#F97316',
};
const FALLBACK_COLORS = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#EF4444',
  '#EC4899',
  '#14B8A6',
  '#6366F1',
];

function modelColor(model: string, idx: number): string {
  return MODEL_COLORS[model] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length]!;
}

export function CostChart() {
  const [history, setHistory] = useState<CostPoint[]>([]);
  const [budget, setBudget] = useState<BudgetInfo>({ daily: 0, weekly: 0, monthly: 0 });
  const [limits, setLimits] = useState<Limits>({ daily: 5, weekly: 25, monthly: 100 });
  const [viewMode, setViewMode] = useState<'bar' | 'stacked'>('stacked');

  const fetchHistory = useCallback(() => {
    apiFetch('/api/dashboard/cost-history?days=7', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (d.history) setHistory(d.history);
        if (d.budgetStatus) setBudget(d.budgetStatus);
        if (d.limits) setLimits(d.limits);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    window.addEventListener('ws:cost_updated', fetchHistory);
    window.addEventListener('ws:decision_updated', fetchHistory);
    window.addEventListener('ws:meeting_created', fetchHistory);
    window.addEventListener('ws:workflow_completed', fetchHistory);
    return () => {
      window.removeEventListener('ws:cost_updated', fetchHistory);
      window.removeEventListener('ws:decision_updated', fetchHistory);
      window.removeEventListener('ws:meeting_created', fetchHistory);
      window.removeEventListener('ws:workflow_completed', fetchHistory);
    };
  }, [fetchHistory]);

  // Collect all models across all days
  const allModels = [...new Set(history.flatMap((h) => Object.keys(h.byModel)))];
  const maxCost = Math.max(...history.map((h) => h.cost), limits.daily, 0.01);

  const totalCost = history.reduce((sum, h) => sum + h.cost, 0);
  // `calls` is a running cumulative total from the backend, so take the last day's value
  const totalCalls = history.length > 0 ? (history[history.length - 1]!.calls ?? 0) : 0;

  return (
    <div className="flex h-full flex-col rounded-lg border bg-surface-primary p-4">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium text-content-secondary">Cost Analysis</div>
        <div className="flex gap-1">
          <button
            onClick={() => setViewMode('stacked')}
            className={`rounded px-2 py-0.5 text-xs ${viewMode === 'stacked' ? 'bg-accent-muted text-accent' : 'text-content-tertiary hover:bg-surface-muted bg-surface-input'}`}
          >
            By Model
          </button>
          <button
            onClick={() => setViewMode('bar')}
            className={`rounded px-2 py-0.5 text-xs ${viewMode === 'bar' ? 'bg-accent-muted text-accent' : 'text-content-tertiary hover:bg-surface-muted bg-surface-input'}`}
          >
            Total
          </button>
        </div>
      </div>

      {/* Summary row */}
      <div className="mb-3 flex gap-3 text-xs">
        <span className="text-content-tertiary">
          Total:{' '}
          <span className="font-mono font-medium text-content-secondary">
            ${totalCost.toFixed(3)}
          </span>
        </span>
        <span className="text-content-tertiary">
          Calls:{' '}
          <span className="font-mono font-medium text-content-secondary">
            {totalCalls}
          </span>
        </span>
        <span className="text-content-tertiary">
          Daily budget:{' '}
          <span
            className={`font-mono font-medium ${budget.daily > limits.daily * 0.8 ? 'text-intent-danger' : 'text-content-secondary'}`}
          >
            ${budget.daily.toFixed(2)} / ${limits.daily}
          </span>
        </span>
      </div>

      {history.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-content-tertiary">
          No data yet
        </div>
      ) : (
        <>
          {/* Chart area */}
          <div className="flex flex-1 items-end gap-1">
            {history.map((point, i) => (
              <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <span className="font-mono text-[10px] text-content-tertiary">
                  ${point.cost.toFixed(2)}
                </span>

                {viewMode === 'bar' ? (
                  <div
                    className="min-h-[2px] w-full rounded-t-sm bg-accent transition-all"
                    style={{ height: `${Math.max((point.cost / maxCost) * 100, 2)}%` }}
                  />
                ) : (
                  <div
                    className="flex min-h-[2px] w-full flex-col-reverse overflow-hidden rounded-t-sm"
                    style={{ height: `${Math.max((point.cost / maxCost) * 100, 2)}%` }}
                  >
                    {allModels.map((model, mi) => {
                      const modelCost = point.byModel[model] ?? 0;
                      if (modelCost === 0) return null;
                      return (
                        <div
                          key={model}
                          title={`${model}: ${modelCost.toFixed(3)}`}
                          style={{
                            height: `${Math.max((modelCost / maxCost) * 100, 2)}%`,
                            backgroundColor: modelColor(model, mi),
                          }}
                          className="min-h-[2px] w-full transition-all"
                        />
                      );
                    })}
                  </div>
                )}

                <span className="text-[10px] text-content-tertiary">
                  {new Date(point.date).toLocaleDateString(undefined, { weekday: 'short' })}
                </span>
              </div>
            ))}
          </div>

          {/* Model legend */}
          {viewMode === 'stacked' && allModels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2">
              {allModels.map((model, mi) => {
                const modelTotal = history.reduce((sum, h) => sum + (h.byModel[model] ?? 0), 0);
                return (
                  <div key={model} className="flex items-center gap-1 text-[10px] text-content-tertiary">
                    <span
                      className="h-2 w-2 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: modelColor(model, mi) }}
                    />
                    <span className="font-mono">{model}</span>
                    <span>${modelTotal.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Budget limit line indicator */}
          <div className="mt-1 text-[10px] text-content-tertiary">
            Daily limit: ${limits.daily} | Weekly: ${limits.weekly} | Monthly: ${limits.monthly}
          </div>
        </>
      )}
    </div>
  );
}
