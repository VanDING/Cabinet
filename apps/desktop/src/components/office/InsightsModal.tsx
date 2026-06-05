import { ModalOverlay } from '../ModalOverlay';
import { useEffect } from 'react';
import { X, Lightbulb } from 'lucide-react';
import { useInsights } from './useInsights.js';

interface Props { onClose: () => void; }

export function InsightsModal({ onClose }: Props) {
  const { insights, loading } = useInsights();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <ModalOverlay isOpen={true} onClose={onClose} contentClassName="m-4 flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-border bg-surface-primary shadow-lg">
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-2"><Lightbulb size={16} className="text-accent" /><h3 className="text-lg font-semibold text-content-primary">Insights</h3></div>
        <button onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded-sm text-content-tertiary hover:text-content-secondary"><X size={16} /></button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-12"><div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" /></div>
      ) : insights.length === 0 ? (
        <div className="py-12 text-center text-sm text-content-tertiary">No insights yet</div>
      ) : (
        <div className="overflow-y-auto px-5 pb-4 space-y-1.5">
          {insights.map((insight) => (
            <div key={insight.id} className="rounded-sm border border-border bg-surface-muted p-3">
              <p className="text-sm text-content-secondary">{insight.text}</p>
              <div className="mt-1 flex items-center justify-between text-[11px] text-content-tertiary">
                <span>Relevance {(insight.relevance * 100).toFixed(0)}%</span>
                <span>{new Date(insight.timestamp).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </ModalOverlay>
  );
}
