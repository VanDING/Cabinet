import { useState } from 'react';

export interface MeetingData {
  meetingId: string;
  topic: string;
  synthesis: string;
  perspectives: Array<{ advisor: string; role: string; content: string }>;
  crossValidation?: {
    agreements: string[];
    disagreements: string[];
    contradictions: string[];
    gaps: string[];
    coherenceScore: number;
  } | null;
  decisionId?: string | null;
}

interface Props {
  data: MeetingData;
  isDark?: boolean;
}

export function MeetingCard({ data, isDark }: Props) {
  const [expanded, setExpanded] = useState(true);

  const { topic, synthesis, perspectives, crossValidation, decisionId } = data;

  const borderClass = isDark ? 'border-gray-700' : 'border-blue-200';
  const bgClass = isDark ? 'bg-gray-800/80' : 'bg-white';
  const headerBg = isDark ? 'bg-gray-700/80' : 'bg-blue-50';
  const textClass = isDark ? 'text-gray-200' : 'text-gray-800';
  const subtextClass = isDark ? 'text-gray-400' : 'text-gray-500';
  const advisorBg = isDark ? 'bg-gray-700/60' : 'bg-gray-50';
  const advisorBorder = isDark ? 'border-gray-600' : 'border-gray-200';
  const scoreColor =
    (crossValidation?.coherenceScore ?? 0) >= 0.7
      ? 'text-green-600 dark:text-green-400'
      : (crossValidation?.coherenceScore ?? 0) >= 0.5
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400';

  return (
    <div className={`my-3 rounded-lg border ${borderClass} ${bgClass} shadow-sm overflow-hidden`}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex w-full items-center justify-between px-4 py-2.5 ${headerBg} transition-colors`}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">
            Meeting
          </span>
          <span className={`text-sm font-medium ${textClass}`}>{topic}</span>
        </div>
        <div className="flex items-center gap-3">
          {crossValidation && (
            <span className={`text-xs font-mono ${scoreColor}`}>
              Coherence: {(crossValidation.coherenceScore * 100).toFixed(0)}%
            </span>
          )}
          <span className={`text-xs ${subtextClass} transform transition-transform ${expanded ? 'rotate-180' : ''}`}>
            &#9660;
          </span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 py-3 space-y-3">
          {/* Advisor Perspectives */}
          {perspectives.length > 0 && (
            <div className="space-y-2">
              <p className={`text-xs font-medium ${subtextClass}`}>
                Advisor Perspectives ({perspectives.length})
              </p>
              <div className="grid gap-2">
                {perspectives.map((p, i) => (
                  <div
                    key={i}
                    className={`rounded border ${advisorBorder} ${advisorBg} p-2.5`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-medium ${textClass}`}>{p.advisor}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                        isDark ? 'bg-gray-600 text-gray-300' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {p.role}
                      </span>
                    </div>
                    <p className={`text-xs leading-relaxed ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                      {p.content}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Synthesis */}
          {synthesis && (
            <div>
              <p className={`text-xs font-medium mb-1 ${subtextClass}`}>Chair Synthesis</p>
              <div className={`text-sm leading-relaxed ${textClass}`}>
                {synthesis}
              </div>
            </div>
          )}

          {/* Cross Validation Details */}
          {crossValidation && (
            <div className="space-y-1.5">
              <p className={`text-xs font-medium ${subtextClass}`}>Cross Validation</p>

              {crossValidation.disagreements.length > 0 && (
                <div>
                  <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    Disagreements:
                  </span>
                  <ul className="mt-0.5 space-y-0.5">
                    {crossValidation.disagreements.map((d, i) => (
                      <li key={i} className="text-xs text-amber-700 dark:text-amber-300 ml-3 list-disc">
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {crossValidation.gaps.length > 0 && (
                <div>
                  <span className="text-xs font-medium text-red-600 dark:text-red-400">
                    Gaps:
                  </span>
                  <ul className="mt-0.5 space-y-0.5">
                    {crossValidation.gaps.map((g, i) => (
                      <li key={i} className="text-xs text-red-700 dark:text-red-300 ml-3 list-disc">
                        {g}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {crossValidation.agreements.length > 0 && (
                <div>
                  <span className="text-xs font-medium text-green-600 dark:text-green-400">
                    Agreements:
                  </span>
                  <ul className="mt-0.5 space-y-0.5">
                    {crossValidation.agreements.map((a, i) => (
                      <li key={i} className="text-xs text-green-700 dark:text-green-300 ml-3 list-disc">
                        {a}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Auto-extracted Decision */}
          {decisionId && (
            <div className={`rounded border px-3 py-2 text-xs ${
              isDark ? 'border-green-700 bg-green-900/30 text-green-300' : 'border-green-300 bg-green-50 text-green-700'
            }`}>
              Decision <code className="font-mono">{decisionId}</code> was auto-extracted from this meeting.
              Review it in the Office or Decision Room.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
