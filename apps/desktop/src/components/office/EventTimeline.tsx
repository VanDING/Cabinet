import { useState, useEffect, useCallback, memo } from 'react';

import { apiFetch, authHeaders } from '../../utils/api.js';

import { getBufferedEvents } from '../../utils/eventBuffer.js';


import { toast } from 'sonner';interface Event {
  message: string;
  type: string;
  time: Date;
}

interface Props {
  projectId?: string;
  onExpand?: () => void;
}

export const EventTimeline = memo(function EventTimeline({ projectId, onExpand }: Props) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    const qs = params.toString();
    return qs ? `/api/dashboard/summary?${qs}` : '/api/dashboard/summary';
  }, [projectId]);

  const fetchEvents = useCallback(() => {
    apiFetch(buildUrl(), { headers: authHeaders() })
      .then((res) => res.json())
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
      .catch(() => {
        toast.error('Failed to load events');
      })
      .finally(() => setLoading(false));
  }, [buildUrl]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    const handler = () => fetchEvents();
    window.addEventListener('ws:decision_created', handler);
    window.addEventListener('ws:decision_updated', handler);
    window.addEventListener('ws:project_created', handler);
    window.addEventListener('ws:project_deleted', handler);
    window.addEventListener('ws:workflow_started', handler);
    window.addEventListener('ws:workflow_completed', handler);
    window.addEventListener('ws:task_updated', handler);
    window.addEventListener('ws:deliverable_created', handler);

    const buffered = getBufferedEvents();
    const hasRelevant = buffered.some((e) =>
      [
        'decision_created',
        'decision_updated',
        'project_created',
        'project_deleted',
        'workflow_started',
        'workflow_completed',
        'task_updated',
        'deliverable_created',
      ].includes(e.type),
    );
    if (hasRelevant) fetchEvents();

    return () => {
      window.removeEventListener('ws:decision_created', handler);
      window.removeEventListener('ws:decision_updated', handler);
      window.removeEventListener('ws:project_created', handler);
      window.removeEventListener('ws:project_deleted', handler);
      window.removeEventListener('ws:workflow_started', handler);
      window.removeEventListener('ws:workflow_completed', handler);
      window.removeEventListener('ws:task_updated', handler);
      window.removeEventListener('ws:deliverable_created', handler);
    };
  }, [fetchEvents]);

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEvents([]);
  };

  return (
    <div
      onClick={onExpand}
      className="border-border bg-surface-primary flex h-full cursor-pointer flex-col rounded-lg border p-4 shadow-xs"
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-content-secondary text-xs font-semibold">Recent Events</h3>
        <button
          onClick={handleClear}
          className="text-content-tertiary hover:bg-surface-muted hover:text-content-secondary rounded-sm px-2 py-0.5 text-xs transition-colors"
        >
          Clear
        </button>
      </div>
      {loading ? (
        <p className="text-content-tertiary text-xs">Loading...</p>
      ) : events.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-content-tertiary text-xs">No recent events</p>
        </div>
      ) : (
        <div className="flex-1 space-y-2 overflow-y-auto">
          {events.map((event, i) => (
            <div
              key={i}
              className="border-border flex justify-between border-b pb-1.5 text-xs last:border-0 last:pb-0"
            >
              <span className="text-content-secondary">{event.message}</span>
              <span className="text-content-tertiary ml-2 shrink-0">
                {event.time.toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
