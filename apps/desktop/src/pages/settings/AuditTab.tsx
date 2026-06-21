import { useState, useEffect } from 'react';
import { Button } from '@cabinet/ui';
import { apiFetch, authHeaders } from '../../utils/api.js';

// ── Audit Log Tab ──
export function AuditTab() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ entityType: '', limit: 50 });

  const fetchAudit = () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(filter.limit) });
    if (filter.entityType) params.set('entityType', filter.entityType);

    apiFetch(`/api/audit?${params}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setEntries(d.entries ?? []))
      .catch((err) => {
        console.warn('Operation failed', err);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchAudit();
  }, []);

  return (
    <div>
      <h2 className="text-content-primary mb-4 text-lg font-semibold">Audit Log</h2>

      {/* Filters */}
      <div className="mb-4 flex gap-2">
        <select
          value={filter.entityType}
          onChange={(e) => {
            setFilter((p) => ({ ...p, entityType: e.target.value }));
          }}
          className="border-border bg-surface-primary text-content-primary rounded-sm border px-3 py-1.5 text-sm"
        >
          <option value="">All types</option>
          <option value="decision">Decision</option>
          <option value="meeting">Meeting</option>
          <option value="workflow">Workflow</option>
          <option value="employee">Employee</option>
          <option value="skill">Skill</option>
        </select>
        <Button size="sm" onClick={fetchAudit}>
          Refresh
        </Button>
      </div>

      {loading ? (
        <p className="text-content-tertiary text-sm">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="text-content-tertiary text-sm">No audit entries found.</p>
      ) : (
        <div className="max-h-[60vh] space-y-1 overflow-y-auto">
          {entries.map((e: any, i: number) => (
            <div key={i} className="border-border flex items-center gap-3 border-b py-2 text-xs">
              <span className="text-content-tertiary w-14 shrink-0">
                {new Date(e.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span className="bg-surface-muted text-content-secondary w-16 shrink-0 rounded-sm px-1.5 py-0.5 text-center font-medium capitalize">
                {e.action}
              </span>
              <span className="text-content-tertiary w-12 shrink-0">{e.entityType}</span>
              <span className="text-content-tertiary flex-1 truncate font-mono">{e.entityId}</span>
              <span className="text-content-tertiary">{e.actor}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
