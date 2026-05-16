import { useState, useEffect } from 'react';
import { apiFetch, authHeaders } from '../../utils/pin.js';

interface CostPoint {
  date: string;
  cost: number;
  calls: number;
  byModel: Record<string, number>;
}

interface BudgetInfo {
  daily: number; weekly: number; monthly: number;
}

interface Limits {
  daily: number; weekly: number; monthly: number;
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
const FALLBACK_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#EC4899', '#14B8A6', '#6366F1'];

function modelColor(model: string, idx: number): string {
  return MODEL_COLORS[model] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length]!;
}

export function CostChart() {
  const [history, setHistory] = useState<CostPoint[]>([]);
  const [budget, setBudget] = useState<BudgetInfo>({ daily: 0, weekly: 0, monthly: 0 });
  const [limits, setLimits] = useState<Limits>({ daily: 5, weekly: 25, monthly: 100 });
  const [viewMode, setViewMode] = useState<'bar' | 'stacked'>('stacked');

  useEffect(() => {
    apiFetch('/api/dashboard/cost-history?days=7', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => {
        if (d.history) setHistory(d.history);
        if (d.budgetStatus) setBudget(d.budgetStatus);
        if (d.limits) setLimits(d.limits);
      })
      .catch(() => {});
  }, []);

  // Collect all models across all days
  const allModels = [...new Set(history.flatMap(h => Object.keys(h.byModel)))];
  const maxCost = Math.max(
    ...history.map(h => h.cost),
    limits.daily,
    0.01,
  );

  const totalCost = history.reduce((sum, h) => sum + h.cost, 0);
  const totalCalls = history.reduce((sum, h) => sum + (h.calls ?? 0), 0);

  return (
    <div className="h-full bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-lg p-4 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Cost Analysis</div>
        <div className="flex gap-1">
          <button
            onClick={() => setViewMode('stacked')}
            className={`text-xs px-2 py-0.5 rounded ${viewMode === 'stacked' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          >
            By Model
          </button>
          <button
            onClick={() => setViewMode('bar')}
            className={`text-xs px-2 py-0.5 rounded ${viewMode === 'bar' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          >
            Total
          </button>
        </div>
      </div>

      {/* Summary row */}
      <div className="flex gap-3 mb-3 text-xs">
        <span className="text-gray-500">
          Total: <span className="font-mono font-medium text-gray-700 dark:text-gray-300">${totalCost.toFixed(3)}</span>
        </span>
        <span className="text-gray-500">
          Calls: <span className="font-mono font-medium text-gray-700 dark:text-gray-300">{totalCalls}</span>
        </span>
        <span className="text-gray-500">
          Daily budget: <span className={`font-mono font-medium ${budget.daily > limits.daily * 0.8 ? 'text-red-500' : 'text-gray-700 dark:text-gray-300'}`}>
            ${budget.daily.toFixed(2)} / ${limits.daily}
          </span>
        </span>
      </div>

      {history.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-gray-400">No data yet</div>
      ) : (
        <>
          {/* Chart area */}
          <div className="flex-1 flex items-end gap-1">
            {history.map((point, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                <span className="text-[10px] font-mono text-gray-500 dark:text-gray-400">
                  ${point.cost.toFixed(2)}
                </span>

                {viewMode === 'bar' ? (
                  <div
                    className="w-full bg-blue-500 dark:bg-blue-400 rounded-t-sm transition-all min-h-[2px]"
                    style={{ height: `${Math.max((point.cost / maxCost) * 100, 2)}%` }}
                  />
                ) : (
                  <div className="w-full flex flex-col-reverse rounded-t-sm overflow-hidden min-h-[2px]"
                    style={{ height: `${Math.max((point.cost / maxCost) * 100, 2)}%` }}>
                    {allModels.map((model, mi) => {
                      const modelCost = point.byModel[model] ?? 0;
                      if (modelCost === 0) return null;
                      return (
                        <div
                          key={model}
                          title={`${model}: $${modelCost.toFixed(3)}`}
                          style={{
                            height: `${Math.max((modelCost / maxCost) * 100, 2)}%`,
                            backgroundColor: modelColor(model, mi),
                          }}
                          className="w-full transition-all min-h-[2px]"
                        />
                      );
                    })}
                  </div>
                )}

                <span className="text-[10px] text-gray-400">
                  {new Date(point.date).toLocaleDateString(undefined, { weekday: 'short' })}
                </span>
              </div>
            ))}
          </div>

          {/* Model legend */}
          {viewMode === 'stacked' && allModels.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 pt-2 border-t dark:border-gray-700">
              {allModels.map((model, mi) => {
                const modelTotal = history.reduce((sum, h) => sum + (h.byModel[model] ?? 0), 0);
                return (
                  <div key={model} className="flex items-center gap-1 text-[10px] text-gray-500">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: modelColor(model, mi) }} />
                    <span className="font-mono">{model}</span>
                    <span>${modelTotal.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Budget limit line indicator */}
          <div className="text-[10px] text-gray-400 mt-1">
            Daily limit: ${limits.daily} | Weekly: ${limits.weekly} | Monthly: ${limits.monthly}
          </div>
        </>
      )}
    </div>
  );
}
