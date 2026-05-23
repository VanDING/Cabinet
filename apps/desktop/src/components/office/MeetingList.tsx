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
  const { addToast } = useToast();

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams({ limit: '20' });
    if (projectId) params.set('projectId', projectId);
    return `/api/meetings?${params.toString()}`;
  }, [projectId]);

  const fetchMeetings = useCallback(() => {
    apiFetch(buildUrl(), { headers: authHeaders() })
      .then((res) => res.json())
      .then((data) => {
        if (data.meetings) setMeetings(data.meetings);
      })
      .catch(() => {
        addToast('error', 'Failed to load meetings');
      });
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
    const hasRelevant = buffered.some((e) => e.type === 'meeting_created' || e.type === 'meeting_updated');
    if (hasRelevant) fetchMeetings();

    return () => {
      window.removeEventListener('ws:meeting_created', handleUpdate);
      window.removeEventListener('ws:meeting_updated', handleUpdate);
    };
  }, [fetchMeetings]);

  if (meetings.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-gray-400 dark:text-gray-500">
          <p className="text-sm">No meetings yet</p>
          <p className="mt-1 text-xs">Start a meeting via chat to see results here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-300">Meetings</h3>
        <span className="text-xs text-gray-400">{meetings.length}</span>
      </div>
      {meetings.map((m) => (
        <div
          key={m.id}
          className="border-b border-gray-100 px-3 py-2 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/50"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-xs font-medium text-gray-800 dark:text-gray-200">
              {m.title}
            </p>
            <span className="flex-shrink-0 text-xs text-gray-400">
              {m.createdAt ? new Date(m.createdAt).toLocaleDateString() : ''}
            </span>
          </div>
          {m.tags?.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {m.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
});
