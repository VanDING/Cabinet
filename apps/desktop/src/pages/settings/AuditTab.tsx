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
      <h2 className="mb-4 text-lg font-semibold text-gray-900">Audit Log</h2>

      {/* Filters */}
      <div className="mb-4 flex gap-2">
        <select
          value={filter.entityType}
          onChange={(e) => {
            setFilter((p) => ({ ...p, entityType: e.target.value }));
          }}
          className="rounded border bg-white px-3 py-1.5 text-sm text-gray-900"
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
        <p className="text-sm text-gray-400">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-gray-400">No audit entries found.</p>
      ) : (
        <div className="max-h-[60vh] space-y-1 overflow-y-auto">
          {entries.map((e: any, i: number) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b py-2 text-xs"
            >
              <span className="w-14 flex-shrink-0 text-gray-400">
                {new Date(e.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span className="w-16 flex-shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-center font-medium capitalize text-gray-600">
                {e.action}
              </span>
              <span className="w-12 flex-shrink-0 text-gray-400">{e.entityType}</span>
              <span className="flex-1 truncate font-mono text-gray-500">{e.entityId}</span>
              <span className="text-gray-400">{e.actor}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
