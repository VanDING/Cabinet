import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, BarChart3 } from 'lucide-react';
import { apiFetch } from '../utils/pin.js';

interface EvaluationItem {
  id: string;
  overallScore: number;
  dimensions: Record<string, { score: number; feedback: string }>;
  feedback: string;
  sourceType: string;
  sourceId?: string;
  evaluatorModel: string;
  createdAt: string;
}

interface Props {
  activeProjectId?: string | null;
}

export function EvaluationTab({ activeProjectId }: Props) {
  const [evaluations, setEvaluations] = useState<EvaluationItem[]>([]);
  const [summary, setSummary] = useState({ total: 0, avgScore: 0, maxScore: 0, minScore: 0 });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const projectId = activeProjectId ?? 'default';

  useEffect(() => {
    (async () => {
      try {
        const [listRes, summaryRes] = await Promise.all([
          apiFetch(`/api/evaluations?projectId=${projectId}&limit=50`),
          apiFetch(`/api/evaluations/summary?projectId=${projectId}`),
        ]);
        if (listRes.ok) setEvaluations((await listRes.json()).evaluations ?? []);
        if (summaryRes.ok) setSummary(await summaryRes.json());
      } catch {
        /* ignore */
      }
    })();
  }, [projectId]);

  const borderClasses = 'border-border';
  const cardBg = 'bg-surface-elevated';
  const textClasses = 'text-content-primary';
  const subClasses = 'text-content-tertiary';
  const greenClasses = 'text-intent-success';
  const redClasses = 'text-intent-danger';

  const scoreColor = (s: number) =>
    s >= 7 ? greenClasses : s >= 5 ? 'text-intent-warning' : redClasses;

  return (
    <div className="space-y-4 overflow-auto p-6">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Evaluations', value: summary.total },
          { label: 'Average Score', value: summary.avgScore },
          { label: 'Highest', value: summary.maxScore },
          { label: 'Lowest', value: summary.minScore },
        ].map((s) => (
          <div
            key={s.label}
            className={`rounded-lg border ${borderClasses} ${cardBg} p-3 text-center`}
          >
            <div className={`text-2xl font-bold ${textClasses}`}>{s.value}</div>
            <div className={`text-xs ${subClasses}`}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Evaluations list */}
      {evaluations.length === 0 ? (
        <p className={subClasses}>
          No evaluations yet. Use the evaluate tool in chat to score AI outputs.
        </p>
      ) : (
        <div className="space-y-2">
          {evaluations.map((ev) => (
            <div
              key={ev.id}
              className={`rounded-lg border ${borderClasses} bg-surface-primary`}
            >
              <div
                onClick={() => setExpandedId(expandedId === ev.id ? null : ev.id)}
                className="flex cursor-pointer items-center justify-between p-3"
              >
                <div className="flex items-center gap-3">
                  <span className={`text-lg font-bold ${scoreColor(ev.overallScore)}`}>
                    {ev.overallScore}
                  </span>
                  <div>
                    <div className={`text-sm font-medium ${textClasses}`}>
                      {ev.sourceType}
                      {ev.sourceId ? ` · ${ev.sourceId.slice(0, 20)}` : ''}
                    </div>
                    <div className={`text-xs ${subClasses}`}>
                      {new Date(ev.createdAt).toLocaleString()} · {ev.evaluatorModel}
                    </div>
                  </div>
                </div>
                <BarChart3 size={16} className={subClasses} />
              </div>
              {expandedId === ev.id && (
                <div className={`border-t ${borderClasses} space-y-2 p-3`}>
                  <div className="grid grid-cols-4 gap-2">
                    {Object.entries(ev.dimensions).map(([dim, d]) => (
                      <div key={dim} className={`rounded border ${borderClasses} p-2`}>
                        <div className={`text-xs ${subClasses} capitalize`}>{dim}</div>
                        <div className={`text-sm font-bold ${scoreColor(d.score)}`}>
                          {d.score}/10
                        </div>
                        <div className={`mt-1 text-xs ${subClasses}`}>{d.feedback}</div>
                      </div>
                    ))}
                  </div>
                  {ev.feedback && (
                    <p className={`mt-2 text-sm ${textClasses}`}>{ev.feedback}</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
