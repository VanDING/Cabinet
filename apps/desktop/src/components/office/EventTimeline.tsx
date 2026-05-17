import { useState, useEffect, memo } from 'react';
import { useToast } from '../Toast';
import { apiFetch, authHeaders } from '../../utils/pin.js';

interface Event {
  message: string;
  time: Date;
}

export const EventTimeline = memo(function EventTimeline() {
  const { addToast } = useToast();
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    apiFetch('/api/dashboard/summary', { headers: authHeaders() })
      .then((res) => res.json())
      .then((data) => {
        if (data.recentEvents) {
          setEvents(data.recentEvents.map((e: any) => ({ ...e, time: new Date(e.time) })));
        }
      })
      .catch(() => {
        addToast('error', 'Failed to load events');
      });
  }, [addToast]);

  return (
    <div className="h-full overflow-y-auto rounded-lg border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h3 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-200">Recent Events</h3>
      {events.length === 0 ? (
        <p className="text-xs text-gray-400">No recent events.</p>
      ) : (
        <div className="space-y-2">
          {events.map((event, i) => (
            <div
              key={i}
              className="flex justify-between border-b pb-1.5 text-xs last:border-0 last:pb-0 dark:border-gray-700"
            >
              <span className="text-gray-700 dark:text-gray-300">{event.message}</span>
              <span className="ml-2 flex-shrink-0 text-gray-400">
                {event.time.toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
