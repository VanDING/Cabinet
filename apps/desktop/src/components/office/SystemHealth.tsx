import { useEffect } from 'react';
import { apiFetch, authHeaders } from '../../utils/api.js';
import { usePolling } from '../../hooks/usePolling';

interface HealthData {
  system: {
    platform: string;
    nodeVersion: string;
    uptime: { process: number; os: number };
    cpu: { cores: number; model: string; usage: number | null };
    memory: { processMB: string; usedGB: string; totalGB: string };
    database: { sizeMB: string };
    network: 'connected' | 'disconnected';
    llm: 'connected' | 'disconnected' | 'unconfigured';
  };
}

export function SystemHealth() {
  const {
    data: health,
    loading,
    refresh,
  } = usePolling<HealthData>(
    () => apiFetch('/health/system', { headers: authHeaders() }).then((r) => r.json()),
    30000,
  );

  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener('ws:workflow_started', handler);
    window.addEventListener('ws:workflow_completed', handler);
    return () => {
      window.removeEventListener('ws:workflow_started', handler);
      window.removeEventListener('ws:workflow_completed', handler);
    };
  }, [refresh]);

  if (!health) {
    return (
      <div className="border-border bg-surface-primary text-content-tertiary flex h-full items-center justify-center rounded-lg border p-4 text-xs shadow-xs">
        {loading ? 'Loading...' : 'No data'}
      </div>
    );
  }

  const s = health.system;

  const statusDot = (state: string) => {
    if (state === 'connected') return 'bg-intent-success';
    if (state === 'unconfigured') return 'bg-intent-warning';
    return 'bg-intent-danger';
  };

  const statusLabel = (state: string) => {
    if (state === 'connected') return 'Connected';
    if (state === 'unconfigured') return 'Not configured';
    return 'Disconnected';
  };

  const uptimeMin = Math.floor(s.uptime.process / 60);
  const uptimeStr =
    uptimeMin < 60 ? `${uptimeMin}m` : `${Math.floor(uptimeMin / 60)}h ${uptimeMin % 60}m`;

  return (
    <div className="border-border bg-surface-primary flex h-full flex-col rounded-lg border p-4 shadow-xs">
      <div className="text-content-secondary mb-3 text-sm font-medium">System Health</div>
      <div className="flex-1 space-y-2.5 text-xs">
        {/* CPU */}
        <div className="flex items-center justify-between">
          <span className="text-content-tertiary">CPU</span>
          <div className="flex items-center gap-2">
            {s.cpu.usage !== null && s.cpu.usage !== undefined ? (
              <>
                <div className="bg-surface-muted h-1.5 w-20 overflow-hidden rounded-full">
                  <div
                    className="bg-accent h-full rounded-full transition-all"
                    style={{ width: `${s.cpu.usage}%` }}
                  />
                </div>
                <span className="text-content-secondary w-9 text-right tabular-nums">
                  {s.cpu.usage}%
                </span>
              </>
            ) : (
              <span className="text-content-tertiary">--</span>
            )}
          </div>
        </div>

        {/* Memory */}
        <div className="flex items-center justify-between">
          <span className="text-content-tertiary">Memory</span>
          <span className="text-content-secondary">
            {s.memory.usedGB} / {s.memory.totalGB} GB
          </span>
        </div>

        {/* Network */}
        <div className="flex items-center justify-between">
          <span className="text-content-tertiary">Network</span>
          <div className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${statusDot(s.network)}`} />
            <span className="text-content-secondary">{statusLabel(s.network)}</span>
          </div>
        </div>

        {/* Server */}
        <div className="flex items-center justify-between">
          <span className="text-content-tertiary">Server</span>
          <div className="flex items-center gap-1.5">
            <span className="bg-intent-success h-1.5 w-1.5 rounded-full" />
            <span className="text-content-secondary">Connected</span>
          </div>
        </div>

        {/* LLM API */}
        <div className="flex items-center justify-between">
          <span className="text-content-tertiary">LLM API</span>
          <div className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${statusDot(s.llm)}`} />
            <span className="text-content-secondary">{statusLabel(s.llm)}</span>
          </div>
        </div>

        {/* Uptime */}
        <div className="flex items-center justify-between">
          <span className="text-content-tertiary">Uptime</span>
          <span className="text-content-secondary">{uptimeStr}</span>
        </div>

        {/* Database */}
        <div className="flex items-center justify-between">
          <span className="text-content-tertiary">Database</span>
          <span className="text-content-secondary">{s.database.sizeMB}</span>
        </div>
      </div>
    </div>
  );
}
