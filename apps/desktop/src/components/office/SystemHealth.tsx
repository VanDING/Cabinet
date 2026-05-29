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
      <div className="flex h-full items-center justify-center rounded-lg border bg-surface-primary p-4 text-xs text-content-tertiary">
        {loading ? 'Loading...' : 'No data'}
      </div>
    );
  }

  const s = health.system;
  const m = health.metrics;

  return (
    <div className="flex h-full flex-col rounded-lg border bg-surface-primary p-4">
      <div className="mb-3 text-sm font-medium text-content-secondary">System Health</div>
      <div className="flex-1 space-y-2 text-xs">
        <div className="flex justify-between">
          <span className="text-content-tertiary">CPU</span>
          <span className="text-content-secondary">{s.cpu.cores} cores</span>
        </div>
        <div className="flex justify-between">
          <span className="text-content-tertiary">Memory (process)</span>
          <span className="font-mono text-content-secondary">{s.memory.processMB}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-content-tertiary">Memory (free)</span>
          <span className="font-mono text-content-secondary">
            {s.memory.systemFreeMB}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-content-tertiary">Database</span>
          <span className="font-mono text-content-secondary">{s.database.sizeMB}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-content-tertiary">Uptime</span>
          <span className="text-content-secondary">
            {Math.floor(s.uptime.process / 60)}m
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-content-tertiary">LLM Calls</span>
          <span className="text-content-secondary">{m?.totalCalls ?? '-'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-content-tertiary">Backup</span>
          <span className={health.backup?.available ? 'text-intent-success' : 'text-content-tertiary'}>
            {health.backup?.available ? 'Active' : 'N/A'}
          </span>
        </div>
      </div>
    </div>
  );
}
