import { useState, useEffect, useCallback, memo } from 'react';
import { useToast } from '../Toast';
import { apiFetch, authHeaders } from '../../utils/pin.js';
import { getBufferedEvents } from '../../utils/eventBuffer.js';

interface Event {
  message: string;
  time: Date;
}

interface Props {
  projectId?: string;
}

export const EventTimeline = memo(function EventTimeline({ projectId }: Props) {
  const { addToast } = useToast();
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
          setEvents(data.recentEvents.map((e: any) => ({ ...e, time: new Date(e.time) })));
        }
      })
      .catch(() => {
        addToast('error', 'Failed to load events');
      })
      .finally(() => setLoading(false));
  }, [addToast, buildUrl]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    const handler = () => fetchEvents();
    window.addEventListener('ws:decision_created', handler);
    window.addEventListener('ws:decision_updated', handler);
    window.addEventListener('ws:meeting_created', handler);
    window.addEventListener('ws:project_created', handler);
    window.addEventListener('ws:project_deleted', handler);
    window.addEventListener('ws:workflow_started', handler);
    window.addEventListener('ws:workflow_completed', handler);
    window.addEventListener('ws:task_updated', handler);
    window.addEventListener('ws:deliverable_created', handler);

    // Replay buffered events that arrived before mount
    const buffered = getBufferedEvents();
    const hasRelevant = buffered.some((e) =>
      [
        'decision_created',
        'decision_updated',
        'meeting_created',
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
      window.removeEventListener('ws:meeting_created', handler);
      window.removeEventListener('ws:project_created', handler);
      window.removeEventListener('ws:project_deleted', handler);
      window.removeEventListener('ws:workflow_started', handler);
      window.removeEventListener('ws:workflow_completed', handler);
      window.removeEventListener('ws:task_updated', handler);
      window.removeEventListener('ws:deliverable_created', handler);
    };
  }, [fetchEvents]);

  return (
    <div className="h-full overflow-y-auto rounded-lg border border-border bg-surface-primary p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-content-primary">Recent Events</h3>
      {loading ? (
        <p className="text-xs text-content-tertiary">Loading...</p>
      ) : events.length === 0 ? (
        <>
          <p className="text-xs text-content-tertiary">No recent events.</p>
          <p className="mt-1 text-xs text-content-tertiary">
            Activity appears as agents run tasks, meetings, and workflows
          </p>
        </>
      ) : (
        <div className="space-y-2">
          {events.map((event, i) => (
            <div
              key={i}
              className="flex justify-between border-b border-border pb-1.5 text-xs last:border-0 last:pb-0"
            >
              <span className="text-content-secondary">{event.message}</span>
              <span className="ml-2 flex-shrink-0 text-content-tertiary">
                {event.time.toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
