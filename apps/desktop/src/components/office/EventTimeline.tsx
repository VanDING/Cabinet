import { useState, useEffect } from 'react';

interface Event {
  message: string;
  time: Date;
}

export function EventTimeline() {
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    fetch('/api/dashboard/summary', { headers: { 'x-cabinet-pin': '1234' } })
      .then(res => res.json())
      .then(data => {
        if (data.recentEvents) {
          setEvents(data.recentEvents.map((e: any) => ({ ...e, time: new Date(e.time) })));
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="h-full bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg p-4 overflow-y-auto">
      <h3 className="font-semibold text-sm text-gray-800 dark:text-gray-200 mb-3">Recent Events</h3>
      {events.length === 0 ? (
        <p className="text-xs text-gray-400">No recent events.</p>
      ) : (
        <div className="space-y-2">
          {events.map((event, i) => (
            <div key={i} className="flex justify-between text-xs border-b dark:border-gray-700 last:border-0 pb-1.5 last:pb-0">
              <span className="text-gray-700 dark:text-gray-300">{event.message}</span>
              <span className="text-gray-400 ml-2 flex-shrink-0">{event.time.toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
