import { useState } from 'react';

export function Calendar() {
  const [date] = useState(new Date());
  const year = date.getFullYear();
  const month = date.getMonth();
  const today = date.getDate();

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

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border bg-white p-3 dark:border-gray-600 dark:bg-gray-800">
      <div className="mb-2 truncate text-center text-sm font-medium text-gray-700 dark:text-gray-300">
        {monthNames[month]} {year}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 gap-px text-center text-xs">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <div key={d} className="truncate text-[10px] text-gray-400">
            {d}
          </div>
        ))}
        {weeks.flat().map((d, i) => (
          <div
            key={i}
            className={`flex items-center justify-center truncate text-[10px] ${d === today ? 'rounded bg-blue-600 text-white' : d ? 'text-gray-600 dark:text-gray-300' : ''}`}
          >
            {d ?? ''}
          </div>
        ))}
      </div>
    </div>
  );
}
