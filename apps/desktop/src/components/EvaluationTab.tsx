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
  isDark?: boolean;
  activeProjectId?: string | null;
}

export function EvaluationTab({ isDark, activeProjectId }: Props) {
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
      } catch { /* ignore */ }
    })();
  }, [projectId]);

  const border = isDark ? 'border-gray-700' : 'border-gray-200';
  const bg = isDark ? 'bg-gray-800' : 'bg-white';
  const cardBg = isDark ? 'bg-gray-800/50' : 'bg-gray-50';
  const text = isDark ? 'text-gray-200' : 'text-gray-800';
  const sub = isDark ? 'text-gray-400' : 'text-gray-500';
  const green = isDark ? 'text-green-400' : 'text-green-600';
  const red = isDark ? 'text-red-400' : 'text-red-600';

  const scoreColor = (s: number) => (s >= 7 ? green : s >= 5 ? 'text-yellow-500' : red);

  return (
    <div className="p-6 space-y-4 overflow-auto">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Evaluations', value: summary.total },
          { label: 'Average Score', value: summary.avgScore },
          { label: 'Highest', value: summary.maxScore },
          { label: 'Lowest', value: summary.minScore },
        ].map((s) => (
          <div key={s.label} className={`rounded-lg border ${border} ${cardBg} p-3 text-center`}>
            <div className={`text-2xl font-bold ${text}`}>{s.value}</div>
            <div className={`text-xs ${sub}`}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Evaluations list */}
      {evaluations.length === 0 ? (
        <p className={sub}>No evaluations yet. Use the evaluate tool in chat to score AI outputs.</p>
      ) : (
        <div className="space-y-2">
          {evaluations.map((ev) => (
            <div key={ev.id} className={`rounded-lg border ${border} ${bg}`}>
              <div
                onClick={() => setExpandedId(expandedId === ev.id ? null : ev.id)}
                className="flex items-center justify-between p-3 cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <span className={`text-lg font-bold ${scoreColor(ev.overallScore)}`}>{ev.overallScore}</span>
                  <div>
                    <div className={`text-sm font-medium ${text}`}>{ev.sourceType}{ev.sourceId ? ` · ${ev.sourceId.slice(0, 20)}` : ''}</div>
                    <div className={`text-xs ${sub}`}>{new Date(ev.createdAt).toLocaleString()} · {ev.evaluatorModel}</div>
                  </div>
                </div>
                <BarChart3 size={16} className={sub} />
              </div>
              {expandedId === ev.id && (
                <div className={`border-t ${border} p-3 space-y-2`}>
                  <div className="grid grid-cols-4 gap-2">
                    {Object.entries(ev.dimensions).map(([dim, d]) => (
                      <div key={dim} className={`rounded border ${border} p-2`}>
                        <div className={`text-xs ${sub} capitalize`}>{dim}</div>
                        <div className={`text-sm font-bold ${scoreColor(d.score)}`}>{d.score}/10</div>
                        <div className={`text-xs mt-1 ${sub}`}>{d.feedback}</div>
                      </div>
                    ))}
                  </div>
                  {ev.feedback && <p className={`text-sm ${text} mt-2`}>{ev.feedback}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
