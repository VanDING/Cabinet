import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { apiFetch, authHeaders } from '../../utils/api.js';
import { ModalOverlay } from '../ModalOverlay';

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
    apiFetch('/api/factory', { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => {
        if (data.workflows) setWorkflows(data.workflows);
      })
      .catch((err) => {
        console.warn('Operation failed', err);
      })
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
    <ModalOverlay
      isOpen={true}
      onClose={onClose}
      contentClassName="m-4 max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-surface-primary shadow-lg"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <h3 className="text-content-primary text-lg font-semibold">Active Workflows</h3>
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
      ) : active.length === 0 && other.length === 0 ? (
        <div className="text-content-tertiary py-12 text-center text-sm">No active workflows</div>
      ) : (
        <div className="px-5 pb-4">
          {active.length > 0 && (
            <div className="space-y-1">
              {active.map((w) => {
                const cfg = STATUS_CONFIG[w.status] ?? DEFAULT_STATUS;
                return (
                  <div
                    key={w.id}
                    className="hover:bg-surface-muted flex items-center gap-3 rounded-lg px-3 py-2.5"
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${cfg.color.split(' ')[0]}`} />
                    <span className="text-content-primary min-w-0 flex-1 truncate text-sm font-medium">
                      {w.name}
                    </span>
                    <span
                      className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${cfg.color}`}
                    >
                      {cfg.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {other.length > 0 && (
            <div className={active.length > 0 ? 'border-border mt-3 border-t pt-3' : ''}>
              <p className="text-content-tertiary mb-2 text-[10px] font-medium tracking-wider uppercase">
                Other
              </p>
              <div className="space-y-1">
                {other.map((w) => {
                  const cfg = STATUS_CONFIG[w.status] ?? DEFAULT_STATUS;
                  return (
                    <div
                      key={w.id}
                      className="hover:bg-surface-muted flex items-center gap-3 rounded-lg px-3 py-2.5 opacity-60 hover:opacity-100"
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${cfg.color.split(' ')[0]}`}
                      />
                      <span className="text-content-secondary min-w-0 flex-1 truncate text-sm">
                        {w.name}
                      </span>
                      <span
                        className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${cfg.color}`}
                      >
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
    </ModalOverlay>
  );
}
