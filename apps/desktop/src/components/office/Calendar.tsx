import { useState } from 'react';

export function Calendar() {
  const [date] = useState(new Date());
  const year = date.getFullYear();
  const month = date.getMonth();
  const today = date.getDate();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const weeks: (number | null)[][] = [];
  let week: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) week.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length > 0) weeks.push(week);

  return (
    <div className="h-full bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-lg p-3 flex flex-col overflow-hidden">
      <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 text-center truncate">{monthNames[month]} {year}</div>
      <div className="grid grid-cols-7 gap-px text-xs text-center flex-1 min-h-0">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
          <div key={d} className="text-gray-400 truncate text-[10px]">{d}</div>
        ))}
        {weeks.flat().map((d, i) => (
          <div key={i} className={`truncate text-[10px] flex items-center justify-center ${d === today ? 'bg-blue-600 text-white rounded' : d ? 'text-gray-600 dark:text-gray-300' : ''}`}>
            {d ?? ''}
          </div>
        ))}
      </div>
    </div>
  );
}
