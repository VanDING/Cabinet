import { useState, useEffect } from 'react';
import { apiFetch, authHeaders } from '../../utils/pin.js';

export function SystemHealth() {
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    apiFetch('/health/system', { headers: authHeaders() })
      .then(r => r.json())
      .then(setHealth)
      .catch(() => {});
  }, []);

  if (!health) {
    return (
      <div className="h-full bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-lg p-4 flex items-center justify-center text-xs text-gray-400">
        Loading...
      </div>
    );
  }

  const s = health.system;
  const m = health.metrics;

  return (
    <div className="h-full bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-lg p-4 flex flex-col">
      <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">System Health</div>
      <div className="flex-1 space-y-2 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-500">CPU</span>
          <span className="text-gray-700 dark:text-gray-300">{s.cpu.cores} cores</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Memory (process)</span>
          <span className="text-gray-700 dark:text-gray-300 font-mono">{s.memory.processMB}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Memory (free)</span>
          <span className="text-gray-700 dark:text-gray-300 font-mono">{s.memory.systemFreeMB}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Database</span>
          <span className="text-gray-700 dark:text-gray-300 font-mono">{s.database.sizeMB}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Uptime</span>
          <span className="text-gray-700 dark:text-gray-300">{Math.floor(s.uptime.process / 60)}m</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">LLM Calls</span>
          <span className="text-gray-700 dark:text-gray-300">{m?.totalCalls ?? '-'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Backup</span>
          <span className={health.backup?.available ? 'text-green-600' : 'text-gray-400'}>
            {health.backup?.available ? 'Active' : 'N/A'}
          </span>
        </div>
      </div>
    </div>
  );
}
