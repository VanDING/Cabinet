import { useState, useEffect, useCallback } from 'react';
import { Button, Card, Tabs } from '@cabinet/ui';
import { apiFetch, authHeaders, authJsonHeaders } from '../utils/api.js';
import { KnowledgeTab } from '../components/KnowledgeTab';
import { EvaluationTab } from '../components/EvaluationTab';
import { GraphTab } from '../components/graph/GraphTab';

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
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-intent-success text-xs font-bold text-content-inverse">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="text-sm font-semibold text-content-primary">{name}</span>
      </div>
      {total > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-content-secondary">
            <span>Total: {total}</span>
            <span className="text-intent-success">Approved: {approved}</span>
            <span className="text-intent-danger">Rejected: {rejected}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
            <div className="h-full rounded-full bg-intent-success" style={{ width: `${rate}%` }} />
          </div>
          <div className="text-[10px] text-content-tertiary">Approval rate: {rate}%</div>
        </div>
      )}
      {decisions.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-content-secondary">Decision History</p>
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {decisions.slice(0, 20).map((d, i) => {
              const rd = isRecord(d) ? d : {};
              const title = getStr(rd, 'title') || getStr(rd, 'description') || 'Decision';
              const action = getStr(rd, 'action') || getStr(rd, 'status') || 'unknown';
              const date = getStr(rd, 'date') || getStr(rd, 'timestamp') || '';
              const badgeColor =
                action === 'approved'
                  ? 'bg-intent-success-muted text-intent-success'
                  : action === 'rejected'
                    ? 'bg-intent-danger-muted text-intent-danger'
                    : 'bg-surface-muted text-content-secondary';
              return (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-sm border border-border px-2 py-1"
                >
                  <span
                    className="truncate text-[11px] text-content-secondary"
                    title={title}
                  >
                    {title}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    {date && (
                      <span className="text-[10px] text-content-tertiary">
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
  const rawDecisions = getArr(data, 'key_decisions') as string[];
  const keyDecisions = rawDecisions.length > 0 ? rawDecisions : (getArr(data, 'keyDecisions') as string[]);

  return (
    <div className="space-y-3">
      {summary && (
        <div>
          <p className="mb-1 text-xs font-medium text-content-secondary">Summary</p>
          <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-content-secondary">
            {summary}
          </p>
        </div>
      )}
      {goals.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-content-secondary">Goals</p>
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-content-secondary">
            {goals.map((g, i) => (
              <li key={i}>{typeof g === 'string' ? g : JSON.stringify(g)}</li>
            ))}
          </ul>
        </div>
      )}
      {milestones.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-content-secondary">Milestones</p>
          <div className="space-y-1">
            {milestones.map((m, i) => {
              if (typeof m === 'string') {
                return (
                  <div key={i} className="text-[11px] text-content-secondary">
                    {m}
                  </div>
                );
              }
              const rm = isRecord(m) ? m : {};
              const title = getStr(rm, 'title') || getStr(rm, 'name') || 'Milestone';
              const status = getStr(rm, 'status') || 'pending';
              const badgeColor =
                status === 'done' || status === 'completed'
                  ? 'bg-intent-success-muted text-intent-success'
                  : status === 'in_progress'
                    ? 'bg-accent-muted text-accent'
                    : 'bg-surface-muted text-content-secondary';
              return (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-sm border border-border px-2 py-1"
                >
                  <span className="text-[11px] text-content-secondary">{title}</span>
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
          <p className="mb-1 text-xs font-medium text-content-secondary">Key Decisions</p>
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-content-secondary">
            {keyDecisions.map((d, i) => (
              <li key={i}>{typeof d === 'string' ? d : JSON.stringify(d)}</li>
            ))}
          </ul>
        </div>
      )}
      {!summary && goals.length === 0 && milestones.length === 0 && keyDecisions.length === 0 && (
        <p className="text-xs italic text-content-tertiary">
          No project context yet. Use chat to update the project summary, add milestones, or create decisions.
        </p>
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
                <p className="mb-0.5 text-xs font-medium text-content-secondary">{key}</p>
                {typeof val === 'string' ? (
                  <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-content-secondary">
                    {val}
                  </p>
                ) : Array.isArray(val) ? (
                  <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-content-secondary">
                    {val.map((v, i) => (
                      <li key={i}>{typeof v === 'string' ? v : JSON.stringify(v)}</li>
                    ))}
                  </ul>
                ) : (
                  <pre className="whitespace-pre-wrap font-mono text-[11px] text-content-secondary">
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
        <p key={i} className="mt-2 text-sm font-semibold text-content-primary">
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
          className="list-disc space-y-0.5 pl-4 text-[11px] text-content-secondary"
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
          className="list-decimal space-y-0.5 pl-4 text-[11px] text-content-secondary"
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
        <p key={i} className="text-[11px] leading-relaxed text-content-secondary">
          {line}
        </p>,
      );
    } else if (line.trim() === '') {
      // Skip blank lines, but add spacing via className when needed
    } else {
      elements.push(
        <p key={i} className="text-[11px] leading-relaxed text-content-secondary">
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
          <span className="shrink-0 text-[11px] font-medium text-content-secondary">
            {k}:
          </span>
          {typeof v === 'string' ? (
            <span className="whitespace-pre-wrap text-[11px] text-content-secondary">
              {v}
            </span>
          ) : typeof v === 'number' || typeof v === 'boolean' ? (
            <span className="text-[11px] text-content-secondary">{String(v)}</span>
          ) : isRecord(v) ? (
            <div className="space-y-0.5 pl-2">
              {Object.entries(v).map(([sk, sv]) => (
                <div key={sk} className="flex items-start gap-1">
                  <span className="text-[10px] text-content-tertiary">{sk}:</span>
                  <span className="whitespace-pre-wrap text-[10px] text-content-secondary">
                    {typeof sv === 'string' ? sv : JSON.stringify(sv)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <span className="whitespace-pre-wrap font-mono text-[11px] text-content-secondary">
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
      <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-content-secondary">
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
        <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-content-secondary">
          {content}
        </p>
      );
  }
}

const layerColors: Record<string, string> = {
  short_term: 'bg-accent-muted text-accent',
  long_term: 'bg-intent-purple-muted text-intent-purple',
  entity: 'bg-intent-success-muted text-intent-success',
  project: 'bg-intent-warning-muted text-intent-warning',
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
        <h1 className="text-2xl font-bold text-content-primary">Memory</h1>
        <span className="text-sm text-content-tertiary">
          Browse, search, and manage system memory
        </span>
      </div>

      <Tabs
        className="mb-4"
        tabs={['memory', 'knowledge', 'evaluation', 'graph'].map((id) => ({ id, label: id }))}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as 'memory' | 'knowledge' | 'evaluation' | 'graph')}
      />

      {activeTab === 'knowledge' ? (
        <KnowledgeTab />
      ) : activeTab === 'evaluation' ? (
        <EvaluationTab />
      ) : activeTab === 'graph' ? (
        <GraphTab />
      ) : (
        <>
          {/* Filters */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {['all', 'short_term', 'long_term', 'entity', 'project'].map((layer) => (
              <button
                key={layer}
                onClick={() => setFilter(layer)}
                className={`rounded-full border border-border px-3 py-1.5 text-xs transition-colors ${
                  filter === layer
                    ? 'border-accent bg-accent text-content-inverse'
                    : 'border-border text-content-secondary hover:bg-surface-elevated bg-surface-input'
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
              className="ml-auto w-48 rounded-lg border border-border bg-surface-primary px-3 py-1.5 text-sm text-content-primary"
            />
            <Button variant="ghost" size="xs" onClick={fetchMemories}>
              Refresh
            </Button>
            <Button
              size="xs"
              onClick={handleConsolidate}
              disabled={consolidating}
            >
              {consolidating ? 'Consolidating...' : 'Consolidate Now'}
            </Button>
            {consolidateResult && (
              <span className="text-xs text-content-tertiary">{consolidateResult}</span>
            )}
          </div>

          {/* Stats */}
          <div className="mb-6 grid grid-cols-4 gap-3">
            {['short_term', 'long_term', 'entity', 'project'].map((layer) => (
              <Card key={layer} padding="sm" className="text-center">
                <div className="text-2xl font-bold text-content-primary">
                  {loading ? '-' : (layerCounts[layer] ?? 0)}
                </div>
                <div className="text-xs capitalize text-content-tertiary">
                  {layer.replace('_', ' ')}
                </div>
              </Card>
            ))}
          </div>

          <div className="mb-3 text-xs text-content-tertiary">{total} total entries</div>

          {/* Memory list */}
          <div className="space-y-2">
            {entries.map((m) => {
              const isExpanded = expanded.has(m.id);
              return (
                <Card
                  key={m.id}
                  padding="none"
                  className="group transition-shadow hover:shadow-xs"
                >
                  <div
                    className="flex cursor-pointer items-start gap-2 p-3"
                    onClick={() => toggleExpand(m.id)}
                  >
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${layerColors[m.layer] || 'bg-surface-muted text-content-secondary'}`}
                    >
                      {m.layer.replace('_', ' ')}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-sm ${isExpanded ? '' : 'line-clamp-2'} text-content-secondary`}
                      >
                        {isExpanded ? (
                          <LayerContent layer={m.layer} content={m.content} />
                        ) : (
                          <span className="text-[11px] text-content-secondary">
                            {(() => {
                              const parsed = tryParseJson(m.content);
                              if (isRecord(parsed)) {
                                const summary = getStr(parsed, 'summary');
                                if (summary) return summary;
                                const name = getStr(parsed, 'name') || getStr(parsed, 'title');
                                if (name) return name;
                                const pid = getStr(parsed, 'projectId');
                                if (pid) {
                                  const goalsLen = (getArr(parsed, 'goals') as unknown[]).length;
                                  const milestonesLen = (getArr(parsed, 'milestones') as unknown[]).length;
                                  const decisionsLen = (getArr(parsed, 'keyDecisions') as unknown[]).length;
                                  if (goalsLen + milestonesLen + decisionsLen > 0) {
                                    return `Project ${pid.slice(0, 8)} — ${goalsLen} goals, ${milestonesLen} milestones, ${decisionsLen} decisions`;
                                  }
                                  return `Project ${pid.slice(0, 8)} — empty`;
                                }
                              }
                              return (
                                m.content.slice(0, 200) + (m.content.length > 200 ? '...' : '')
                              );
                            })()}
                          </span>
                        )}
                      </span>
                      {!isExpanded && m.content.length > 150 && (
                        <span className="text-xs text-content-tertiary">Click to expand</span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-content-tertiary">
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
                      className="shrink-0 text-xs text-content-tertiary opacity-0 transition-opacity hover:text-intent-danger group-hover:opacity-100"
                      aria-label="Delete"
                    >
                      &times;
                    </button>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-border px-3 py-2">
                      <div className="mb-2 text-xs text-content-tertiary">ID: {m.id}</div>
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
                                  <span className="text-xs text-content-tertiary">Confidence</span>
                                  <div className="h-2 w-20 overflow-hidden rounded-full bg-surface-muted">
                                    <div
                                      className="h-full rounded-full bg-accent"
                                      style={{ width: `${Math.round(confidence * 100)}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-content-tertiary">
                                    {Math.round(confidence * 100)}%
                                  </span>
                                </div>
                              )}
                              {importance !== undefined && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs text-content-tertiary">Importance</span>
                                  <div className="h-2 w-20 overflow-hidden rounded-full bg-surface-muted">
                                    <div
                                      className="h-full rounded-full bg-intent-purple"
                                      style={{ width: `${Math.round(importance * 100)}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-content-tertiary">
                                    {Math.round(importance * 100)}%
                                  </span>
                                </div>
                              )}
                              {accessCount !== undefined && (
                                <span className="rounded-sm bg-surface-muted px-1.5 py-0.5 text-xs text-content-secondary">
                                  Accessed {accessCount} times
                                </span>
                              )}
                              {validUntil && (
                                <span className="rounded-sm bg-surface-muted px-1.5 py-0.5 text-xs text-content-secondary">
                                  Valid until: {new Date(validUntil).toLocaleDateString()}
                                </span>
                              )}
                              {supersededBy && (
                                <span className="rounded-sm bg-intent-warning-muted px-1.5 py-0.5 text-xs text-intent-warning">
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
                                className="rounded-sm bg-surface-muted px-1.5 py-0.5 font-mono text-xs text-content-secondary"
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
                        <span className="text-xs text-content-tertiary">No metadata</span>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
            {entries.length === 0 && !loading && (
              <div className="py-12 text-center text-content-tertiary">
                <p>No memories found.</p>
                <p className="mt-1 text-xs">
                  Chat with the secretary or create decisions to populate memory layers.
                </p>
              </div>
            )}
            {loading && <div className="py-8 text-center text-content-tertiary">Loading memories...</div>}
          </div>
        </>
      )}
    </div>
  );
}
