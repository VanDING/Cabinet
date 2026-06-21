import { ModalOverlay } from '../ModalOverlay';
import { useEffect } from 'react';
import { X, Lightbulb } from 'lucide-react';
import { useInsights } from './useInsights.js';

interface Props {
  onClose: () => void;
}

export function InsightsModal({ onClose }: Props) {
  const { insights, loading } = useInsights();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <ModalOverlay
      isOpen={true}
      onClose={onClose}
      contentClassName="m-4 flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-border bg-surface-primary shadow-lg"
    >
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <Lightbulb size={16} className="text-accent" />
          <h3 className="text-content-primary text-lg font-semibold">Insights</h3>
        </div>
        <button
          onClick={onClose}
          className="text-content-tertiary hover:text-content-secondary flex h-6 w-6 items-center justify-center rounded-sm"
        >
          <X size={16} />
        </button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="border-accent h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      ) : insights.length === 0 ? (
        <div className="text-content-tertiary py-12 text-center text-sm">No insights yet</div>
      ) : (
        <div className="space-y-1.5 overflow-y-auto px-5 pb-4">
          {insights.map((insight) => (
            <div key={insight.id} className="border-border bg-surface-muted rounded-sm border p-3">
              <p className="text-content-secondary text-sm">{insight.text}</p>
              <div className="text-content-tertiary mt-1 flex items-center justify-between text-[11px]">
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
