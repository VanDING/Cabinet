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

function tryParseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function getStr(obj: unknown, key: string): string | undefined {
  if (!isRecord(obj)) return undefined;
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

function getArr(obj: unknown, key: string): unknown[] {
  if (!isRecord(obj)) return [];
  const v = obj[key];
  return Array.isArray(v) ? v : [];
}

function getNum(obj: unknown, key: string): number | undefined {
  if (!isRecord(obj)) return undefined;
  const v = obj[key];
  return typeof v === 'number' ? v : undefined;
}

function formatMemoryContent(content: string): { isJson: boolean; display: string } {
  try {
    const parsed = JSON.parse(content);
    return { isJson: true, display: JSON.stringify(parsed, null, 2) };
  } catch {
    return { isJson: false, display: content };
  }
}

// ── Layer-aware renderers ─────────────────────────────────────

function EntityCard({ data }: { data: Record<string, unknown> }) {
  const name = getStr(data, 'name') || getStr(data, 'captainName') || 'Captain';
  const decisions =
    (getArr(data, 'decisions') as unknown[]) || (getArr(data, 'decisionHistory') as unknown[]);
  const total = decisions.length || getNum(data, 'totalDecisions') || 0;
  const approved =
    decisions.filter((d) => isRecord(d) && d.action === 'approved').length ||
    getNum(data, 'approved') ||
    0;
  const rejected =
    decisions.filter((d) => isRecord(d) && d.action === 'rejected').length ||
    getNum(data, 'rejected') ||
    0;
  const rate = total > 0 ? Math.round((approved / total) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-green-600 text-xs font-bold text-white">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{name}</span>
      </div>
      {total > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
            <span>Total: {total}</span>
            <span className="text-green-600 dark:text-green-400">Approved: {approved}</span>
            <span className="text-red-500">Rejected: {rejected}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div className="h-full rounded-full bg-green-500" style={{ width: `${rate}%` }} />
          </div>
          <div className="text-[10px] text-gray-400">Approval rate: {rate}%</div>
        </div>
      )}
      {decisions.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Decision History</p>
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {decisions.slice(0, 20).map((d, i) => {
              const rd = isRecord(d) ? d : {};
              const title = getStr(rd, 'title') || getStr(rd, 'description') || 'Decision';
              const action = getStr(rd, 'action') || getStr(rd, 'status') || 'unknown';
              const date = getStr(rd, 'date') || getStr(rd, 'timestamp') || '';
              const badgeColor =
                action === 'approved'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                  : action === 'rejected'
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400';
              return (
                <div
                  key={i}
                  className="flex items-center justify-between rounded border px-2 py-1 dark:border-gray-700"
                >
                  <span
                    className="truncate text-[11px] text-gray-700 dark:text-gray-300"
                    title={title}
                  >
                    {title}
                  </span>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    {date && (
                      <span className="text-[10px] text-gray-400">
                        {new Date(date).toLocaleDateString()}
                      </span>
                    )}
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badgeColor}`}>
                      {action}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectCard({ data }: { data: Record<string, unknown> }) {
  const summary = getStr(data, 'summary') || '';
  const goals = getArr(data, 'goals') as string[];
  const milestones = getArr(data, 'milestones') as unknown[];
  const keyDecisions =
    (getArr(data, 'key_decisions') as string[]) || (getArr(data, 'keyDecisions') as string[]);

  return (
    <div className="space-y-3">
      {summary && (
        <div>
          <p className="mb-1 text-xs font-medium text-gray-700 dark:text-gray-300">Summary</p>
          <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
            {summary}
          </p>
        </div>
      )}
      {goals.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-gray-700 dark:text-gray-300">Goals</p>
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-gray-600 dark:text-gray-400">
            {goals.map((g, i) => (
              <li key={i}>{typeof g === 'string' ? g : JSON.stringify(g)}</li>
            ))}
          </ul>
        </div>
      )}
      {milestones.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-gray-700 dark:text-gray-300">Milestones</p>
          <div className="space-y-1">
            {milestones.map((m, i) => {
              if (typeof m === 'string') {
                return (
                  <div key={i} className="text-[11px] text-gray-600 dark:text-gray-400">
                    {m}
                  </div>
                );
              }
              const rm = isRecord(m) ? m : {};
              const title = getStr(rm, 'title') || getStr(rm, 'name') || 'Milestone';
              const status = getStr(rm, 'status') || 'pending';
              const badgeColor =
                status === 'done' || status === 'completed'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                  : status === 'in_progress'
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400';
              return (
                <div
                  key={i}
                  className="flex items-center justify-between rounded border px-2 py-1 dark:border-gray-700"
                >
                  <span className="text-[11px] text-gray-700 dark:text-gray-300">{title}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badgeColor}`}>
                    {status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {keyDecisions.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-gray-700 dark:text-gray-300">Key Decisions</p>
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-gray-600 dark:text-gray-400">
            {keyDecisions.map((d, i) => (
              <li key={i}>{typeof d === 'string' ? d : JSON.stringify(d)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function LongTermRenderer({ content }: { content: string }) {
  const parsed = tryParseJson(content);
  if (isRecord(parsed)) {
    // If it's a structured object with sections, render as labeled blocks
    const sections = [
      'Recent activity',
      'Pending items',
      'Key decisions',
      'Goals',
      'Milestones',
      'Notes',
    ];
    const matched = sections.filter(
      (s) => getStr(parsed, s) || getArr(parsed, s).length > 0 || isRecord(parsed[s]),
    );
    if (matched.length >= 2) {
      return (
        <div className="space-y-2">
          {matched.map((key) => {
            const val = parsed[key];
            return (
              <div key={key}>
                <p className="mb-0.5 text-xs font-medium text-gray-700 dark:text-gray-300">{key}</p>
                {typeof val === 'string' ? (
                  <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
                    {val}
                  </p>
                ) : Array.isArray(val) ? (
                  <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-gray-600 dark:text-gray-400">
                    {val.map((v, i) => (
                      <li key={i}>{typeof v === 'string' ? v : JSON.stringify(v)}</li>
                    ))}
                  </ul>
                ) : (
                  <pre className="whitespace-pre-wrap font-mono text-[11px] text-gray-600 dark:text-gray-400">
                    {JSON.stringify(val, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      );
    }
  }

  // Treat as rich text / markdown-like
  const lines = content.split('\n');
  const elements: React.ReactElement[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (/^#{1,2}\s/.test(line)) {
      elements.push(
        <p key={i} className="mt-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
          {line.replace(/^#+\s/, '')}
        </p>,
      );
    } else if (/^\*\s/.test(line) || /^-\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && (/^\*\s/.test(lines[i]!) || /^-\s/.test(lines[i]!))) {
        items.push(lines[i]!.replace(/^[*-]\s/, ''));
        i++;
      }
      elements.push(
        <ul
          key={i}
          className="list-disc space-y-0.5 pl-4 text-[11px] text-gray-600 dark:text-gray-400"
        >
          {items.map((it, idx) => (
            <li key={idx}>{it}</li>
          ))}
        </ul>,
      );
      continue;
    } else if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\d+\.\s/, ''));
        i++;
      }
      elements.push(
        <ol
          key={i}
          className="list-decimal space-y-0.5 pl-4 text-[11px] text-gray-600 dark:text-gray-400"
        >
          {items.map((it, idx) => (
            <li key={idx}>{it}</li>
          ))}
        </ol>,
      );
      continue;
    } else if (/\*\*.+?\*\*/.test(line)) {
      // Simple bold inline — render as paragraph preserving some formatting
      elements.push(
        <p key={i} className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
          {line}
        </p>,
      );
    } else if (line.trim() === '') {
      // Skip blank lines, but add spacing via className when needed
    } else {
      elements.push(
        <p key={i} className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
          {line}
        </p>,
      );
    }
    i++;
  }
  return <div className="space-y-1">{elements}</div>;
}

function ShortTermRenderer({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-1">
      {Object.entries(data).map(([k, v]) => (
        <div key={k} className="flex items-start gap-2">
          <span className="flex-shrink-0 text-[11px] font-medium text-gray-700 dark:text-gray-300">
            {k}:
          </span>
          {typeof v === 'string' ? (
            <span className="whitespace-pre-wrap text-[11px] text-gray-600 dark:text-gray-400">
              {v}
            </span>
          ) : typeof v === 'number' || typeof v === 'boolean' ? (
            <span className="text-[11px] text-gray-600 dark:text-gray-400">{String(v)}</span>
          ) : isRecord(v) ? (
            <div className="space-y-0.5 pl-2">
              {Object.entries(v).map(([sk, sv]) => (
                <div key={sk} className="flex items-start gap-1">
                  <span className="text-[10px] text-gray-500">{sk}:</span>
                  <span className="whitespace-pre-wrap text-[10px] text-gray-600 dark:text-gray-400">
                    {typeof sv === 'string' ? sv : JSON.stringify(sv)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <span className="whitespace-pre-wrap font-mono text-[11px] text-gray-600 dark:text-gray-400">
              {JSON.stringify(v, null, 2)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function LayerContent({ layer, content }: { layer: string; content: string }) {
  const parsed = tryParseJson(content);
  if (!isRecord(parsed)) {
    if (layer === 'long_term') return <LongTermRenderer content={content} />;
    return (
      <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
        {content}
      </p>
    );
  }

  switch (layer) {
    case 'entity':
      return <EntityCard data={parsed} />;
    case 'project':
      return <ProjectCard data={parsed} />;
    case 'short_term':
      return <ShortTermRenderer data={parsed} />;
    case 'long_term':
      return <LongTermRenderer content={content} />;
    default:
      return (
        <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
          {content}
        </p>
      );
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
  const [activeTab, setActiveTab] = useState<'memory' | 'knowledge' | 'evaluation' | 'graph'>(
    'memory',
  );
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

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/api/memory/${id}`, { method: 'DELETE', headers: authHeaders() });
      fetchMemories();
    } catch {
      /* ignore */
    }
  };

  const handleConsolidate = async () => {
    setConsolidating(true);
    setConsolidateResult(null);
    try {
      const res = await apiFetch('/api/memory/consolidate', {
        method: 'POST',
        headers: authJsonHeaders(),
      });
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
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="h-full overflow-y-auto p-6 pb-40">
      <div className="mb-6 flex items-baseline gap-3">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Memory</h1>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          Browse, search, and manage system memory
        </span>
      </div>

      {/* Tab bar */}
      <div className={`mb-4 flex gap-4 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
        {(['memory', 'knowledge', 'evaluation', 'graph'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`border-b-2 pb-2 text-sm font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : `border-transparent ${isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`
            }`}
          >
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
              <button
                key={layer}
                onClick={() => setFilter(layer)}
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  filter === layer
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700'
                }`}
              >
                {layer === 'all' ? 'All Layers' : layer.replace('_', ' ')}
              </button>
            ))}
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search memories..."
              className="ml-auto w-48 rounded-lg border bg-white px-3 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
            <button
              onClick={fetchMemories}
              className="rounded-lg border px-3 py-1.5 text-xs text-gray-500 transition-colors hover:text-gray-700 dark:border-gray-600 dark:text-gray-400 dark:hover:text-gray-200"
            >
              Refresh
            </button>
            <button
              onClick={handleConsolidate}
              disabled={consolidating}
              className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
            >
              {consolidating ? 'Consolidating...' : 'Consolidate Now'}
            </button>
            {consolidateResult && (
              <span className="text-xs text-gray-500 dark:text-gray-400">{consolidateResult}</span>
            )}
          </div>

          {/* Stats */}
          <div className="mb-6 grid grid-cols-4 gap-3">
            {['short_term', 'long_term', 'entity', 'project'].map((layer) => (
              <div
                key={layer}
                className="rounded-lg border bg-white p-3 text-center dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {loading ? '-' : (layerCounts[layer] ?? 0)}
                </div>
                <div className="text-xs capitalize text-gray-500 dark:text-gray-400">
                  {layer.replace('_', ' ')}
                </div>
              </div>
            ))}
          </div>

          <div className="mb-3 text-xs text-gray-400">{total} total entries</div>

          {/* Memory list */}
          <div className="space-y-2">
            {entries.map((m) => {
              const isExpanded = expanded.has(m.id);
              return (
                <div
                  key={m.id}
                  className="group rounded-lg border bg-white transition-shadow hover:shadow-sm dark:border-gray-700 dark:bg-gray-800"
                >
                  <div
                    className="flex cursor-pointer items-start gap-2 p-3"
                    onClick={() => toggleExpand(m.id)}
                  >
                    <span
                      className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs ${layerColors[m.layer] || 'bg-gray-100 text-gray-600'}`}
                    >
                      {m.layer.replace('_', ' ')}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-sm ${isExpanded ? '' : 'line-clamp-2'} text-gray-700 dark:text-gray-300`}
                      >
                        {isExpanded ? (
                          <LayerContent layer={m.layer} content={m.content} />
                        ) : (
                          <span className="text-[11px] text-gray-600 dark:text-gray-400">
                            {(() => {
                              const parsed = tryParseJson(m.content);
                              if (isRecord(parsed)) {
                                const summary =
                                  getStr(parsed, 'summary') ||
                                  getStr(parsed, 'name') ||
                                  getStr(parsed, 'title');
                                if (summary) return summary;
                              }
                              return (
                                m.content.slice(0, 200) + (m.content.length > 200 ? '...' : '')
                              );
                            })()}
                          </span>
                        )}
                      </span>
                      {!isExpanded && m.content.length > 150 && (
                        <span className="text-xs text-gray-400">Click to expand</span>
                      )}
                    </span>
                    <span className="flex-shrink-0 text-xs text-gray-400">
                      {new Date(m.timestamp).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(m.id);
                      }}
                      className="flex-shrink-0 text-xs text-gray-400 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                      aria-label="Delete"
                    >
                      &times;
                    </button>
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
                                    <div
                                      className="h-full rounded-full bg-blue-500"
                                      style={{ width: `${Math.round(confidence * 100)}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-gray-500">
                                    {Math.round(confidence * 100)}%
                                  </span>
                                </div>
                              )}
                              {importance !== undefined && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs text-gray-500">Importance</span>
                                  <div className="h-2 w-20 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                                    <div
                                      className="h-full rounded-full bg-purple-500"
                                      style={{ width: `${Math.round(importance * 100)}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-gray-500">
                                    {Math.round(importance * 100)}%
                                  </span>
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
                          {Object.entries(m.metadata)
                            .filter(
                              ([k]) =>
                                ![
                                  'status',
                                  'confidence',
                                  'importance',
                                  'accessCount',
                                  'validUntil',
                                  'supersededBy',
                                ].includes(k),
                            )
                            .map(([k, v]) => (
                              <span
                                key={k}
                                className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                              >
                                {k}:{' '}
                                {typeof v === 'object'
                                  ? JSON.stringify(v).slice(0, 80)
                                  : String(v).slice(0, 80)}
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
                <p className="mt-1 text-xs">
                  Chat with the secretary or create decisions to populate memory layers.
                </p>
              </div>
            )}
            {loading && <div className="py-8 text-center text-gray-400">Loading memories...</div>}
          </div>
        </>
      )}
    </div>
  );
}
