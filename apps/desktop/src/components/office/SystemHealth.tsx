import { useEffect } from 'react';
import { apiFetch, authHeaders } from '../../utils/pin.js';
import { usePolling } from '../../hooks/usePolling';

export function SystemHealth() {
  const {
    data: health,
    loading,
    refresh,
  } = usePolling<any>(
    () => apiFetch('/health/system', { headers: authHeaders() }).then((r) => r.json()),
    30000,
  );

  useEffect(() => {
    const handler = () => {
      refresh();
    };
    window.addEventListener('ws:workflow_started', handler);
    window.addEventListener('ws:workflow_completed', handler);
    return () => {
      window.removeEventListener('ws:workflow_started', handler);
      window.removeEventListener('ws:workflow_completed', handler);
    };
  }, [refresh]);

  if (!health) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border bg-white p-4 text-xs text-gray-400">
        {loading ? 'Loading...' : 'No data'}
      </div>
    );
  }

  const s = health.system;
  const m = health.metrics;

  return (
    <div className="flex h-full flex-col rounded-lg border bg-white p-4">
      <div className="mb-3 text-sm font-medium text-gray-700">System Health</div>
      <div className="flex-1 space-y-2 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-500">CPU</span>
          <span className="text-gray-700">{s.cpu.cores} cores</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Memory (process)</span>
          <span className="font-mono text-gray-700">{s.memory.processMB}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Memory (free)</span>
          <span className="font-mono text-gray-700">
            {s.memory.systemFreeMB}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Database</span>
          <span className="font-mono text-gray-700">{s.database.sizeMB}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Uptime</span>
          <span className="text-gray-700">
            {Math.floor(s.uptime.process / 60)}m
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">LLM Calls</span>
          <span className="text-gray-700">{m?.totalCalls ?? '-'}</span>
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
