import { useState, useEffect } from 'react';
import { apiFetch, authHeaders } from '../utils/pin.js';

interface AuditEntry {
  id: number;
  entityType: string;
  entityId: string;
  action: string;
  actor: string;
  changes: Record<string, unknown>;
  timestamp: string;
}

export function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ entityType: '', entityId: '', limit: 100 });

  const fetchAudit = () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(filter.limit) });
    if (filter.entityType) params.set('entityType', filter.entityType);
    if (filter.entityId) params.set('entityId', filter.entityId);

    apiFetch(`/api/audit?${params}`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => setEntries(d.entries ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchAudit(); }, []);

  const actionColor = (action: string) => {
    if (action.includes('create') || action.includes('approved')) return 'text-green-600 bg-green-50 dark:bg-green-900 dark:text-green-300';
    if (action.includes('delete') || action.includes('rejected')) return 'text-red-600 bg-red-50 dark:bg-red-900 dark:text-red-300';
    if (action.includes('update') || action.includes('edit')) return 'text-blue-600 bg-blue-50 dark:bg-blue-900 dark:text-blue-300';
    return 'text-gray-600 bg-gray-100 dark:bg-gray-700 dark:text-gray-300';
  };

  const entityTypes = [...new Set(entries.map(e => e.entityType))];

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Audit Log</h1>
        <button onClick={fetchAudit} className="text-sm text-blue-500 hover:underline">Refresh</button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6 flex-wrap">
        <select
          value={filter.entityType}
          onChange={e => setFilter(p => ({ ...p, entityType: e.target.value }))}
          className="border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        >
          <option value="">All Types</option>
          {entityTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          placeholder="Entity ID"
          value={filter.entityId}
          onChange={e => setFilter(p => ({ ...p, entityId: e.target.value }))}
          className="border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        />
        <button onClick={fetchAudit}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
          Apply
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <span className="text-gray-400 text-sm">Loading audit log...</span>
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">No audit entries found.</div>
      ) : (
        <div className="space-y-1">
          {entries.map(entry => (
            <div key={entry.id} className="group border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800 flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-gray-750">
              <span className="text-xs text-gray-400 font-mono w-12 flex-shrink-0 pt-0.5">#{entry.id}</span>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-gray-500 font-mono">{entry.entityType}</span>
                  <span className="text-xs text-gray-400">{entry.entityId}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${actionColor(entry.action)}`}>
                    {entry.action}
                  </span>
                </div>
                {Object.keys(entry.changes).length > 0 && (
                  <details className="mt-1">
                    <summary className="text-xs text-gray-500 cursor-pointer">Changes ({Object.keys(entry.changes).length} fields)</summary>
                    <pre className="mt-1 text-xs text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-900 p-2 rounded max-h-24 overflow-auto">
                      {JSON.stringify(entry.changes, null, 2)}
                    </pre>
                  </details>
                )}
              </div>

              <div className="flex-shrink-0 text-right">
                <div className="text-xs text-gray-500 font-mono">{entry.actor}</div>
                <div className="text-[10px] text-gray-400">{new Date(entry.timestamp).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
