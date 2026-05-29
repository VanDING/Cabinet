import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { apiFetch, authHeaders } from '../../utils/pin.js';

interface Workflow {
  id: string;
  name: string;
  status: string;
  projectId: string;
}

interface Props {
  onClose: () => void;
}

const DEFAULT_STATUS = { color: 'bg-surface-muted text-content-tertiary', label: 'Unknown' };

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  active: { color: 'bg-intent-success text-intent-success', label: 'Active' },
  running: { color: 'bg-intent-success text-intent-success', label: 'Running' },
  paused: { color: 'bg-intent-warning text-intent-warning', label: 'Paused' },
  draft: { color: 'bg-content-tertiary text-content-tertiary', label: 'Draft' },
  failed: { color: 'bg-intent-danger text-intent-danger', label: 'Failed' },
  completed: { color: 'bg-surface-muted text-content-tertiary', label: 'Done' },
};

export function ActiveWorkflowsModal({ onClose }: Props) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(() => {
    apiFetch('/api/workflows', { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => {
        if (data.workflows) setWorkflows(data.workflows);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const active = workflows.filter((w) => w.status === 'active' || w.status === 'running');
  const other = workflows.filter((w) => w.status !== 'active' && w.status !== 'running');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="m-4 max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-surface-primary shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h3 className="text-lg font-semibold text-content-primary">Active Workflows</h3>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-content-tertiary hover:text-content-secondary"
          >
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : active.length === 0 && other.length === 0 ? (
          <div className="py-12 text-center text-sm text-content-tertiary">
            No active workflows
          </div>
        ) : (
          <div className="px-5 pb-4">
            {active.length > 0 && (
              <div className="space-y-1">
                {active.map((w) => {
                  const cfg = STATUS_CONFIG[w.status] ?? DEFAULT_STATUS;
                  return (
                    <div
                      key={w.id}
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-muted"
                    >
                      <span className={`h-2 w-2 flex-shrink-0 rounded-full ${cfg.color.split(' ')[0]}`} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-content-primary">
                        {w.name}
                      </span>
                      <span className={`flex-shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${cfg.color}`}>
                        {cfg.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {other.length > 0 && (
              <div className={active.length > 0 ? 'mt-3 border-t border-border pt-3' : ''}>
                <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-content-tertiary">
                  Other
                </p>
                <div className="space-y-1">
                  {other.map((w) => {
                    const cfg = STATUS_CONFIG[w.status] ?? DEFAULT_STATUS;
                    return (
                      <div
                        key={w.id}
                        className="flex items-center gap-3 rounded-lg px-3 py-2.5 opacity-60 hover:bg-surface-muted hover:opacity-100"
                      >
                        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${cfg.color.split(' ')[0]}`} />
                        <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
                          {w.name}
                        </span>
                        <span className={`flex-shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${cfg.color}`}>
                          {cfg.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
