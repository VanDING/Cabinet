import { useState, useEffect } from 'react';
import { Button } from '@cabinet/ui';
import { apiFetch, authHeaders } from '../../utils/pin.js';

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
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchAudit();
  }, []);

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-content-primary">Audit Log</h2>

      {/* Filters */}
      <div className="mb-4 flex gap-2">
        <select
          value={filter.entityType}
          onChange={(e) => {
            setFilter((p) => ({ ...p, entityType: e.target.value }));
          }}
          className="rounded border bg-surface-primary px-3 py-1.5 text-sm text-content-primary"
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
        <p className="text-sm text-content-tertiary">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-content-tertiary">No audit entries found.</p>
      ) : (
        <div className="max-h-[60vh] space-y-1 overflow-y-auto">
          {entries.map((e: any, i: number) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b py-2 text-xs"
            >
              <span className="w-14 flex-shrink-0 text-content-tertiary">
                {new Date(e.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span className="w-16 flex-shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-center font-medium capitalize text-content-secondary">
                {e.action}
              </span>
              <span className="w-12 flex-shrink-0 text-content-tertiary">{e.entityType}</span>
              <span className="flex-1 truncate font-mono text-content-tertiary">{e.entityId}</span>
              <span className="text-content-tertiary">{e.actor}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
