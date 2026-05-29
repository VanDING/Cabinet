import { useState, useEffect, useCallback } from 'react';
import { apiFetch, authHeaders } from '../../utils/pin.js';
import { getBufferedEvents } from '../../utils/eventBuffer.js';

interface MeetingDate {
  date: string; // YYYY-MM-DD
  count: number;
}

interface Props {
  projectId?: string;
}

export function Calendar({ projectId }: Props) {
  const [viewDate, setViewDate] = useState(() => new Date());
  const [meetingDates, setMeetingDates] = useState<Set<string>>(new Set());

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  const fetchMeetingDates = useCallback(() => {
    const params = new URLSearchParams({ limit: '200' });
    if (projectId) params.set('projectId', projectId);
    apiFetch(`/api/meetings?${params.toString()}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => {
        const dates = new Set<string>();
        for (const m of data.meetings ?? []) {
          if (m.createdAt) {
            const d = new Date(m.createdAt);
            const localStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            dates.add(localStr);
          }
        }
        setMeetingDates(dates);
      })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    fetchMeetingDates();
  }, [fetchMeetingDates]);

  useEffect(() => {
    const handler = () => fetchMeetingDates();
    window.addEventListener('ws:meeting_created', handler);

    // Replay buffered events that arrived before mount
    const buffered = getBufferedEvents();
    if (buffered.some((e) => e.type === 'meeting_created')) fetchMeetingDates();

    return () => window.removeEventListener('ws:meeting_created', handler);
  }, [fetchMeetingDates]);

  // Keep viewDate current when month changes (e.g., left open overnight)
  useEffect(() => {
    const now = new Date();
    const msUntilMidnight =
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
    const timer = setTimeout(() => setViewDate(new Date()), msUntilMidnight + 1000);
    return () => clearTimeout(timer);
  }, []);

  const weeks: (number | null)[][] = [];
  let week: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) week.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) weeks.push(week);

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border bg-white p-3">
      {/* Month navigation */}
      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={prevMonth}
          className="rounded px-1 text-xs text-gray-400 hover:text-gray-600:text-gray-200"
        >
          ‹
        </button>
        <div className="truncate text-center text-sm font-medium text-gray-700">
          {monthNames[month]} {year}
        </div>
        <button
          onClick={nextMonth}
          className="rounded px-1 text-xs text-gray-400 hover:text-gray-600:text-gray-200"
        >
          ›
        </button>
      </div>

      {/* Day headers */}
      <div className="grid min-h-0 grid-cols-7 gap-px text-center text-xs">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <div key={d} className="truncate text-[10px] text-gray-400">
            {d}
          </div>
        ))}

        {/* Day cells */}
        {weeks.flat().map((d, i) => {
          const dateStr = d
            ? `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
            : null;
          const hasMeeting = dateStr ? meetingDates.has(dateStr) : false;

          return (
            <div
              key={i}
              className={`relative flex items-center justify-center truncate text-[10px] ${
                d === today.getDate() && month === today.getMonth() && year === today.getFullYear()
                  ? 'rounded bg-blue-600 text-white'
                  : d
                    ? 'text-gray-600'
                    : ''
              }`}
            >
              {d ?? ''}
              {hasMeeting && (
                <span
                  className={`absolute bottom-0.5 h-1 w-1 rounded-full ${
                    d === today.getDate() &&
                    month === today.getMonth() &&
                    year === today.getFullYear()
                      ? 'bg-white'
                      : 'bg-purple-500'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {meetingDates.size > 0 && (
        <div className="mt-1 text-[10px] text-gray-400">
          {meetingDates.size} meeting day{meetingDates.size !== 1 ? 's' : ''} this month
        </div>
      )}
    </div>
  );
}
