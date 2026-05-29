import { useState, useEffect, useCallback, memo } from 'react';
import { useToast } from '../Toast';
import { apiFetch, authHeaders } from '../../utils/pin.js';
import { getBufferedEvents } from '../../utils/eventBuffer.js';

interface MeetingItem {
  id: string;
  projectId: string;
  meetingId: string;
  title: string;
  tags: string[];
  createdAt: string;
}

interface Props {
  projectId?: string;
}

export const MeetingList = memo(function MeetingList({ projectId }: Props) {
  const [meetings, setMeetings] = useState<MeetingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { addToast } = useToast();

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams({ limit: '20' });
    if (projectId) params.set('projectId', projectId);
    return `/api/meetings?${params.toString()}`;
  }, [projectId]);

  const fetchMeetings = useCallback(() => {
    setLoading(true);
    apiFetch(buildUrl(), { headers: authHeaders() })
      .then((res) => res.json())
      .then((data) => {
        if (data.meetings) setMeetings(data.meetings);
      })
      .catch(() => {
        addToast('error', 'Failed to load meetings');
      })
      .finally(() => setLoading(false));
  }, [addToast, buildUrl]);

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

  useEffect(() => {
    const handleUpdate = () => fetchMeetings();
    window.addEventListener('ws:meeting_created', handleUpdate);
    window.addEventListener('ws:meeting_updated', handleUpdate);

    // Replay buffered events that arrived before mount
    const buffered = getBufferedEvents();
    const hasRelevant = buffered.some(
      (e) => e.type === 'meeting_created' || e.type === 'meeting_updated',
    );
    if (hasRelevant) fetchMeetings();

    return () => {
      window.removeEventListener('ws:meeting_created', handleUpdate);
      window.removeEventListener('ws:meeting_updated', handleUpdate);
    };
  }, [fetchMeetings]);

  return (
    <div className="flex h-full flex-col overflow-y-auto rounded-lg border bg-surface-primary">
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center text-content-tertiary">
            <p className="text-xs">Loading meetings...</p>
          </div>
        </div>
      ) : meetings.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center text-content-tertiary">
            <p className="text-sm">No meetings yet</p>
            <p className="mt-1 text-xs">Start a meeting via chat to see results here</p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h3 className="text-xs font-semibold text-content-secondary">Meetings</h3>
            <span className="text-xs text-content-tertiary">{meetings.length}</span>
          </div>
          {meetings.map((m) => (
            <div
              key={m.id}
              className="border-b border-border-subtle px-3 py-2 transition-colors hover:bg-surface-elevated:bg-surface-primary/50"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="truncate text-xs font-medium text-content-primary">
                  {m.title}
                </p>
                <span className="flex-shrink-0 text-xs text-content-tertiary">
                  {m.createdAt ? new Date(m.createdAt).toLocaleDateString() : ''}
                </span>
              </div>
              {m.tags?.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {m.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-intent-purple-muted px-1.5 py-0.5 text-xs text-intent-purple"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
});
