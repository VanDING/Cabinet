import { useState, useEffect, useCallback } from 'react';
import { apiFetch, authHeaders } from '../../utils/api.js';

interface ExtAgent {
  id: string; name: string; source: string; status: string;
  external?: Record<string, unknown>;
}

export function ExternalAgentsTab() {
  const [agents, setAgents] = useState<ExtAgent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await apiFetch('/api/employees', { headers: authHeaders() });
      const data = await res.json() as { employees: ExtAgent[] };
      setAgents((data.employees ?? []).filter((e: ExtAgent) => (e.source ?? '').startsWith('external_')));
    } catch { /* non-critical */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  if (loading) return <p className="text-sm text-content-tertiary">Loading...</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-content-tertiary">External agent configurations are shared with the Employees page. Edit an agent there to change its protocol, command, or connection settings.</p>
      {agents.length === 0 ? (
        <p className="text-sm text-content-tertiary">No external agents registered. Go to Employees → Add → Scan for CLI Agents.</p>
      ) : (
        agents.map((a) => (
          <div key={a.id} className="rounded-lg border border-border bg-surface-primary p-3 flex items-center justify-between">
            <div>
              <span className="font-medium text-content-primary">{a.name}</span>
              <span className="ml-2 text-xs text-content-tertiary">{a.source}</span>
              {a.external && <span className="ml-2 text-xs text-content-tertiary">{(a.external as any).protocol}</span>}
            </div>
            <span className={`rounded-full px-2 py-0.5 text-xs ${a.status === 'active' ? 'bg-green-600/20 text-green-400' : 'bg-gray-600/20 text-gray-400'}`}>{a.status ?? 'offline'}</span>
          </div>
        ))
      )}
    </div>
  );
}
