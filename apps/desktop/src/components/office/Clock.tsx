import { useState, useEffect } from 'react';

export function Clock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex h-full flex-col items-center justify-center rounded-lg border bg-white p-4 dark:border-gray-600 dark:bg-gray-800">
      <div className="font-mono text-3xl font-bold text-gray-800 dark:text-gray-200">
        {time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
      </div>
      <div className="mt-1 text-xs text-gray-400">
        {time.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
      </div>
    </div>
  );
}
