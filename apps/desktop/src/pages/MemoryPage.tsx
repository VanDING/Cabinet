import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, authHeaders } from '../utils/pin.js';

interface MemoryEntry {
  id: string;
  layer: string;
  content: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

const layerColors: Record<string, string> = {
  short_term: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  long_term: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  entity: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  project: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
};

export function MemoryPage() {
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [layerCounts, setLayerCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchMemories = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('layer', filter);
      if (search) params.set('query', search);
      params.set('limit', '50');

      const res = await apiFetch(`/api/memory?${params}`, { headers: authHeaders() });
      const data = await res.json();
      setEntries(data.entries ?? []);
      setLayerCounts(data.layers ?? {});
      setTotal(data.total ?? 0);
    } catch {
      setEntries([]);
      setLayerCounts({});
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => { fetchMemories(); }, [fetchMemories]);

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/api/memory/${id}`, { method: 'DELETE', headers: authHeaders() });
      fetchMemories();
    } catch {}
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-baseline gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Memory</h1>
        <span className="text-sm text-gray-500 dark:text-gray-400">Browse and search across all four memory layers</span>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {['all', 'short_term', 'long_term', 'entity', 'project'].map(layer => (
          <button key={layer} onClick={() => setFilter(layer)}
            className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
              filter === layer
                ? 'bg-blue-600 text-white border-blue-600'
                : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}>
            {layer === 'all' ? 'All Layers' : layer.replace('_', ' ')}
          </button>
        ))}
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search memories..."
          className="ml-auto border dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 w-48" />
        <button onClick={fetchMemories}
          className="px-3 py-1.5 text-xs rounded-lg border dark:border-gray-600 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors">
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {['short_term', 'long_term', 'entity', 'project'].map(layer => (
          <div key={layer} className="border dark:border-gray-700 rounded-lg p-3 text-center bg-white dark:bg-gray-800">
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {loading ? '-' : (layerCounts[layer] ?? 0)}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 capitalize">{layer.replace('_', ' ')}</div>
          </div>
        ))}
      </div>

      <div className="text-xs text-gray-400 mb-3">{total} total entries</div>

      {/* Memory list */}
      <div className="space-y-2">
        {entries.map(m => (
          <div key={m.id} className="group border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800 hover:shadow-sm transition-shadow">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs px-2 py-0.5 rounded-full ${layerColors[m.layer] || 'bg-gray-100 text-gray-600'}`}>{m.layer.replace('_', ' ')}</span>
              <span className="text-xs text-gray-400">{new Date(m.timestamp).toLocaleString()}</span>
              <button
                onClick={() => handleDelete(m.id)}
                className="ml-auto w-4 h-4 flex items-center justify-center rounded text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                aria-label="Delete"
              >&times;</button>
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-all">{m.content}</p>
            {Object.keys(m.metadata || {}).length > 0 && (
              <div className="mt-1 flex gap-2 flex-wrap">
                {Object.entries(m.metadata).map(([k, v]) => (
                  <span key={k} className="text-xs text-gray-400 font-mono">{k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                ))}
              </div>
            )}
          </div>
        ))}
        {entries.length === 0 && !loading && (
          <div className="text-center text-gray-400 py-12">
            <p>No memories found.</p>
            <p className="text-xs mt-1">Chat with the secretary to create memories, or create decisions to populate the memory layers.</p>
          </div>
        )}
        {loading && (
          <div className="text-center text-gray-400 py-8">Loading memories...</div>
        )}
      </div>
    </div>
  );
}
