import { useEffect } from 'react';
import { useInsights } from './useInsights.js';

interface Props { onExpand?: () => void; }

export function InsightsWidget({ onExpand }: Props) {
  const { insights, loading, latest, fetchInsights } = useInsights();

  useEffect(() => {
    window.addEventListener('ws:subconscious_insight', fetchInsights);
    window.addEventListener('ws:memory_changed', fetchInsights);
    return () => {
      window.removeEventListener('ws:subconscious_insight', fetchInsights);
      window.removeEventListener('ws:memory_changed', fetchInsights);
    };
  }, [fetchInsights]);

  return (
    <div onClick={onExpand} className={`flex h-full flex-col rounded-lg border border-border bg-surface-primary p-4 shadow-xs ${onExpand ? 'cursor-pointer' : ''}`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-content-secondary">Insights</h3>
        {!loading && insights.length > 0 && <span className="text-xs text-content-tertiary">{insights.length}</span>}
      </div>
      {loading ? (
        <div className="flex flex-1 items-center justify-center"><div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" /></div>
      ) : latest.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-content-tertiary">No insights yet</div>
      ) : (
        <div className="flex-1 space-y-2 overflow-y-auto">
          {latest.map((insight) => (
            <div key={insight.id} className="rounded-sm bg-surface-muted p-2">
              <p className="line-clamp-2 text-xs text-content-secondary">{insight.text}</p>
              <div className="mt-1 flex items-center justify-between text-[10px] text-content-tertiary">
                <span>Relevance {(insight.relevance * 100).toFixed(0)}%</span>
                <span>{new Date(insight.timestamp).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
