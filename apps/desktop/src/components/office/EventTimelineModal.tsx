import { useState, useEffect, useCallback, useMemo } from 'react';
import { X } from 'lucide-react';
import { apiFetch, authHeaders } from '../../utils/api.js';

interface Event {
  message: string;
  type: string;
  time: Date;
}

interface Props {
  onClose: () => void;
  projectId?: string;
}

const TYPE_CATEGORIES: { key: string; label: string; types: string[] }[] = [
  {
    key: 'decision',
    label: 'Decision',
    types: ['decision_request', 'decision_resolved'],
  },
  {
    key: 'task',
    label: 'Task',
    types: ['task_order', 'task_completed', 'task_failed'],
  },
  {
    key: 'meeting',
    label: 'Meeting',
    types: ['meeting_started', 'meeting_completed', 'deliberation_proposal'],
  },
  {
    key: 'workflow',
    label: 'Workflow',
    types: ['workflow_started', 'workflow_status_changed', 'workflow_completed'],
  },
  {
    key: 'agent',
    label: 'Agent',
    types: ['agent_task_assigned', 'agent_task_completed', 'agent_context_requested', 'agent_context_shared'],
  },
  {
    key: 'secretary',
    label: 'Secretary',
    types: ['secretary_message', 'greeting_generated'],
  },
  {
    key: 'system',
    label: 'System',
    types: ['budget_alert', 'quality_alert', 'system_notification', 'audit_event'],
  },
];

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  TYPE_CATEGORIES.flatMap((c) => c.types.map((t) => [t, c.label])),
);

export function EventTimelineModal({ onClose, projectId }: Props) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    const qs = params.toString();
    return qs ? `/api/dashboard/summary?${qs}` : '/api/dashboard/summary';
  }, [projectId]);

  const fetchData = useCallback(() => {
    apiFetch(buildUrl(), { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => {
        if (data.recentEvents) {
          setEvents(
            data.recentEvents.map((e: any) => ({
              message: e.message,
              type: e.type,
              time: new Date(e.time),
            })),
          );
        }
      })
      .catch((err) => { console.warn('Operation failed', err); })
      .finally(() => setLoading(false));
  }, [buildUrl]);

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

  const filteredEvents = useMemo(() => {
    if (activeFilters.size === 0) return events;
    return events.filter((e) => activeFilters.has(e.type));
  }, [events, activeFilters]);

  const toggleFilter = (type: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
        return new Set(next);
      }
      // Remove same-category types, add this one
      const category = TYPE_CATEGORIES.find((c) => c.types.includes(type));
      if (category) {
        for (const t of category.types) {
          next.delete(t);
        }
      }
      next.add(type);
      return new Set(next);
    });
  };

  const availableTypes = useMemo(() => {
    const seen = new Set<string>();
    const result: { type: string; label: string }[] = [];
    for (const e of events) {
      if (!seen.has(e.type)) {
        seen.add(e.type);
        result.push({ type: e.type, label: CATEGORY_LABEL[e.type] ?? 'Other' });
      }
    }
    return result;
  }, [events]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="m-4 flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-border bg-surface-primary shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h3 className="text-lg font-semibold text-content-primary">Event Timeline</h3>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-content-tertiary hover:text-content-secondary"
          >
            <X size={16} />
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex flex-wrap gap-1.5 px-5 pb-3">
          {availableTypes.map(({ type, label }) => {
            const isActive = activeFilters.has(type);
            return (
              <button
                key={type}
                onClick={() => toggleFilter(type)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-accent-muted text-accent ring-1 ring-accent/30'
                    : 'bg-surface-muted text-content-tertiary hover:text-content-secondary'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Event list */}
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="py-12 text-center text-sm text-content-tertiary">
              {events.length === 0 ? 'No events recorded yet' : 'No events match the selected filters'}
            </div>
          ) : (
            <div className="space-y-0">
              {filteredEvents.map((event, i) => (
                <div
                  key={i}
                  className="flex items-baseline justify-between border-b border-border py-2.5 text-xs last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-content-secondary">{event.message}</span>
                    <span className="ml-2 rounded-sm bg-surface-muted px-1.5 py-0.5 text-[10px] text-content-tertiary">
                      {CATEGORY_LABEL[event.type] ?? event.type}
                    </span>
                  </div>
                  <span className="ml-3 shrink-0 tabular-nums text-content-tertiary">
                    {event.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
