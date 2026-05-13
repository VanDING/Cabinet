import React, { useState } from 'react';

interface MemoryEntry {
  id: string;
  layer: string;
  content: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
}

const demoMemories: MemoryEntry[] = [
  { id: 'm1', layer: 'short_term', content: 'User asked about entering baby-products market', timestamp: new Date('2026-05-14T10:30:00'), metadata: { sessionId: 'sess-1' } },
  { id: 'm2', layer: 'long_term', content: 'Q1 revenue exceeded targets by 15%. Market expansion plans approved.', timestamp: new Date('2026-05-10T09:00:00'), metadata: { projectId: 'proj-1', score: 0.89 } },
  { id: 'm3', layer: 'entity', content: 'Captain prefers concise answers with bullet points', timestamp: new Date('2026-05-01T08:00:00'), metadata: { captainId: 'captain-1' } },
  { id: 'm4', layer: 'project', content: 'Project Launch: Q3 target — enter maternal-infant market with 3 SKU', timestamp: new Date('2026-05-05T14:00:00'), metadata: { projectId: 'proj-1', milestone: 'MVP' } },
  { id: 'm5', layer: 'short_term', content: 'Decision created: Should we enter the baby-products market?', timestamp: new Date('2026-05-14T10:35:00'), metadata: { sessionId: 'sess-1' } },
  { id: 'm6', layer: 'long_term', content: 'Competitor analysis: Top 3 competitors control 60% of maternal-infant market', timestamp: new Date('2026-05-08T11:00:00'), metadata: { projectId: 'proj-1', score: 0.92 } },
];

const layerColors: Record<string, string> = {
  short_term: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  long_term: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  entity: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  project: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
};

export function MemoryPage() {
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const filtered = demoMemories.filter(m => {
    if (filter !== 'all' && m.layer !== filter) return false;
    if (search && !m.content.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Memory</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Browse and search across all four memory layers</p>
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
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {['short_term', 'long_term', 'entity', 'project'].map(layer => (
          <div key={layer} className="border dark:border-gray-700 rounded-lg p-3 text-center bg-white dark:bg-gray-800">
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {demoMemories.filter(m => m.layer === layer).length}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 capitalize">{layer.replace('_', ' ')}</div>
          </div>
        ))}
      </div>

      {/* Memory list */}
      <div className="space-y-2">
        {filtered.map(m => (
          <div key={m.id} className="border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800 hover:shadow-sm transition-shadow">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs px-2 py-0.5 rounded-full ${layerColors[m.layer]}`}>{m.layer.replace('_', ' ')}</span>
              <span className="text-xs text-gray-400">{m.timestamp.toLocaleString()}</span>
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300">{m.content}</p>
            {Object.keys(m.metadata).length > 0 && (
              <div className="mt-1 flex gap-2">
                {Object.entries(m.metadata).map(([k, v]) => (
                  <span key={k} className="text-xs text-gray-400 font-mono">{k}: {String(v)}</span>
                ))}
              </div>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="text-center text-gray-400 py-8">No memories found.</p>
        )}
      </div>
    </div>
  );
}
