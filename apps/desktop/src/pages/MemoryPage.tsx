import { useState, useEffect, useCallback } from 'react';
import { apiFetch, authHeaders, authJsonHeaders } from '../utils/pin.js';
import { KnowledgeTab } from '../components/KnowledgeTab';
import { EvaluationTab } from '../components/EvaluationTab';
import { GraphTab } from '../components/GraphTab';
import { useTheme } from '../hooks/useTheme';

interface MemoryEntry {
  id: string;
  layer: string;
  content: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

function formatMemoryContent(content: string): { isJson: boolean; display: string } {
  try {
    const parsed = JSON.parse(content);
    return { isJson: true, display: JSON.stringify(parsed, null, 2) };
  } catch {
    return { isJson: false, display: content };
  }
}

const layerColors: Record<string, string> = {
  short_term: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  long_term: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  entity: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  project: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
};

function getNumericMeta(meta: Record<string, unknown>, key: string): number | undefined {
  const v = meta[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const parsed = parseFloat(v);
    if (!isNaN(parsed)) return parsed;
  }
  return undefined;
}

export function MemoryPage() {
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [layerCounts, setLayerCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [consolidating, setConsolidating] = useState(false);
  const [consolidateResult, setConsolidateResult] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'memory' | 'knowledge' | 'evaluation' | 'graph'>('memory');
  const { isDark } = useTheme();

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
    } catch { /* ignore */ }
  };

  const handleConsolidate = async () => {
    setConsolidating(true);
    setConsolidateResult(null);
    try {
      const res = await apiFetch('/api/memory/consolidate', { method: 'POST', headers: authJsonHeaders() });
      const data = await res.json();
      setConsolidateResult(`Migrated ${data.migrated ?? 0} entries`);
      setTimeout(() => fetchMemories(), 500);
    } catch (e: any) {
      setConsolidateResult(`Failed: ${e.message}`);
    } finally {
      setConsolidating(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-baseline gap-3">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Memory</h1>
        <span className="text-sm text-gray-500 dark:text-gray-400">Browse, search, and manage system memory</span>
      </div>

      {/* Tab bar */}
      <div className={`flex gap-4 mb-4 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
        {(['memory', 'knowledge', 'evaluation', 'graph'] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`pb-2 text-sm font-medium border-b-2 transition-colors capitalize ${
              activeTab === tab
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : `border-transparent ${isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`
            }`}>
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'knowledge' ? (
        <KnowledgeTab isDark={isDark} />
      ) : activeTab === 'evaluation' ? (
        <EvaluationTab isDark={isDark} />
      ) : activeTab === 'graph' ? (
        <GraphTab isDark={isDark} />
      ) : (
      <>
      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {['all', 'short_term', 'long_term', 'entity', 'project'].map((layer) => (
          <button key={layer} onClick={() => setFilter(layer)}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              filter === layer
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700'
            }`}>
            {layer === 'all' ? 'All Layers' : layer.replace('_', ' ')}
          </button>
        ))}
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search memories..." className="ml-auto w-48 rounded-lg border bg-white px-3 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100" />
        <button onClick={fetchMemories}
          className="rounded-lg border px-3 py-1.5 text-xs text-gray-500 transition-colors hover:text-gray-700 dark:border-gray-600 dark:text-gray-400 dark:hover:text-gray-200">
          Refresh
        </button>
        <button onClick={handleConsolidate} disabled={consolidating}
          className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-purple-700 disabled:opacity-50">
          {consolidating ? 'Consolidating...' : 'Consolidate Now'}
        </button>
        {consolidateResult && (
          <span className="text-xs text-gray-500 dark:text-gray-400">{consolidateResult}</span>
        )}
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-4 gap-3">
        {['short_term', 'long_term', 'entity', 'project'].map((layer) => (
          <div key={layer} className="rounded-lg border bg-white p-3 text-center dark:border-gray-700 dark:bg-gray-800">
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {loading ? '-' : (layerCounts[layer] ?? 0)}
            </div>
            <div className="text-xs capitalize text-gray-500 dark:text-gray-400">{layer.replace('_', ' ')}</div>
          </div>
        ))}
      </div>

      <div className="mb-3 text-xs text-gray-400">{total} total entries</div>

      {/* Memory list */}
      <div className="space-y-2">
        {entries.map((m) => {
          const isExpanded = expanded.has(m.id);
          return (
            <div key={m.id}
              className="group rounded-lg border bg-white transition-shadow hover:shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <div className="flex cursor-pointer items-start gap-2 p-3" onClick={() => toggleExpand(m.id)}>
                <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs ${layerColors[m.layer] || 'bg-gray-100 text-gray-600'}`}>
                  {m.layer.replace('_', ' ')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${isExpanded ? '' : 'line-clamp-2'} text-gray-700 dark:text-gray-300`}>
                    {(() => {
                      const { isJson, display } = formatMemoryContent(m.content);
                      return isJson ? (
                        <pre className="whitespace-pre-wrap font-mono text-xs">{display}</pre>
                      ) : (
                        display
                      );
                    })()}
                  </span>
                  {!isExpanded && m.content.length > 150 && (
                    <span className="text-xs text-gray-400">Click to expand</span>
                  )}
                </span>
                <span className="flex-shrink-0 text-xs text-gray-400">
                  {new Date(m.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
                <button onClick={(e) => { e.stopPropagation(); handleDelete(m.id); }}
                  className="flex-shrink-0 text-xs text-gray-400 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                  aria-label="Delete">&times;</button>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t px-3 py-2 dark:border-gray-700">
                  <div className="mb-2 text-xs text-gray-400">ID: {m.id}</div>
                  {/* Visualized metadata fields */}
                  <div className="mb-2 flex flex-wrap items-center gap-3">
                    {(() => {
                      const confidence = getNumericMeta(m.metadata, 'confidence');
                      const importance = getNumericMeta(m.metadata, 'importance');
                      const accessCount = getNumericMeta(m.metadata, 'accessCount');
                      const validUntil = m.metadata.validUntil as string | undefined;
                      const supersededBy = m.metadata.supersededBy as string | undefined;
                      return (
                        <>
                          {confidence !== undefined && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-gray-500">Confidence</span>
                              <div className="h-2 w-20 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                                <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.round(confidence * 100)}%` }} />
                              </div>
                              <span className="text-xs text-gray-500">{Math.round(confidence * 100)}%</span>
                            </div>
                          )}
                          {importance !== undefined && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-gray-500">Importance</span>
                              <div className="h-2 w-20 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                                <div className="h-full rounded-full bg-purple-500" style={{ width: `${Math.round(importance * 100)}%` }} />
                              </div>
                              <span className="text-xs text-gray-500">{Math.round(importance * 100)}%</span>
                            </div>
                          )}
                          {accessCount !== undefined && (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                              Accessed {accessCount} times
                            </span>
                          )}
                          {validUntil && (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                              Valid until: {new Date(validUntil).toLocaleDateString()}
                            </span>
                          )}
                          {supersededBy && (
                            <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
                              Superseded by: {String(supersededBy).slice(0, 20)}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  {/* Remaining metadata tags */}
                  {Object.keys(m.metadata || {}).length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(m.metadata).filter(([k]) =>
                        !['status', 'confidence', 'importance', 'accessCount', 'validUntil', 'supersededBy'].includes(k)
                      ).map(([k, v]) => (
                        <span key={k} className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                          {k}: {typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 80)}
                        </span>
                      ))}
                    </div>
                  )}
                  {!Object.keys(m.metadata || {}).length && (
                    <span className="text-xs text-gray-400">No metadata</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {entries.length === 0 && !loading && (
          <div className="py-12 text-center text-gray-400">
            <p>No memories found.</p>
            <p className="mt-1 text-xs">Chat with the secretary or create decisions to populate memory layers.</p>
          </div>
        )}
        {loading && <div className="py-8 text-center text-gray-400">Loading memories...</div>}
      </div>
      </>
      )}
    </div>
  );
}
