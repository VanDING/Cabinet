import { useState, useEffect } from 'react';

export function Clock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="h-full bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-lg p-4 flex flex-col items-center justify-center">
      <div className="text-3xl font-mono font-bold text-gray-800 dark:text-gray-200">
        {time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
      </div>
      <div className="text-xs text-gray-400 mt-1">
        {time.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
      </div>
    </div>
  );
}
