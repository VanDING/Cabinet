import { useState, useEffect, useCallback } from 'react';
import { X, Lightbulb } from 'lucide-react';
import { apiFetch, authHeaders } from '../../utils/pin.js';

interface Insight {
  id: string;
  text: string;
  relevance: number;
  relatedEntities: string[];
  timestamp: string;
}

interface Props {
  onClose: () => void;
}

export function InsightsModal({ onClose }: Props) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInsights = useCallback(() => {
    apiFetch('/api/insights', { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => {
        if (data.insights) setInsights(data.insights);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="m-4 flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-border bg-surface-primary shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <div className="flex items-center gap-2">
            <Lightbulb size={16} className="text-accent" />
            <h3 className="text-lg font-semibold text-content-primary">Insights</h3>
          </div>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-content-tertiary hover:text-content-secondary"
          >
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : insights.length === 0 ? (
          <div className="py-12 text-center text-sm text-content-tertiary">
            No insights surfaced yet. Insights emerge as the system connects memories over time.
          </div>
        ) : (
          <div className="overflow-y-auto px-5 pb-4">
            <div className="space-y-3">
              {insights.map((insight) => (
                <div
                  key={insight.id}
                  className="rounded-lg border border-border bg-surface-muted p-3"
                >
                  <p className="text-sm text-content-secondary leading-relaxed">{insight.text}</p>
                  <div className="mt-2 flex items-center gap-3 text-[10px] text-content-tertiary">
                    <span className="rounded-sm bg-accent-muted px-1.5 py-0.5 font-medium text-accent">
                      {Math.round(insight.relevance * 100)}% relevance
                    </span>
                    {insight.relatedEntities.length > 0 && (
                      <span>{insight.relatedEntities.join(', ')}</span>
                    )}
                    <span className="ml-auto">
                      {new Date(insight.timestamp).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
