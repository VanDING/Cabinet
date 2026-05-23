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
  process?: {
    analysisBrief: string;
    advisorSynthesis: string;
    reviewRounds: number;
    reviewPassed: boolean;
    reviewIssues: Array<{ severity: string; detail: string }>;
  };
}

interface Props {
  data: MeetingData;
  isDark?: boolean;
}

export function MeetingCard({ data, isDark }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<'result' | 'process'>('result');

  const { topic, synthesis, perspectives, crossValidation, decisionId, process } = data;

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

  const hasProcess = !!process && process.analysisBrief.length > 0;

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
          {hasProcess && (
            <span className={`text-xs ${subtextClass}`}>
              {process!.reviewPassed ? '✓ Review passed' : '⚠ Review flagged'}
            </span>
          )}
          <span className={`text-xs ${subtextClass} transform transition-transform ${expanded ? 'rotate-180' : ''}`}>
            &#9660;
          </span>
        </div>
      </button>

      {expanded && (
        <div>
          {/* Tabs */}
          {hasProcess && (
            <div className={`flex border-b ${borderClass}`}>
              <button
                onClick={() => setActiveTab('result')}
                className={`px-4 py-2 text-xs font-medium transition-colors ${
                  activeTab === 'result'
                    ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                    : `${subtextClass} hover:text-gray-700 dark:hover:text-gray-300`
                }`}
              >
                Result
              </button>
              <button
                onClick={() => setActiveTab('process')}
                className={`px-4 py-2 text-xs font-medium transition-colors ${
                  activeTab === 'process'
                    ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                    : `${subtextClass} hover:text-gray-700 dark:hover:text-gray-300`
                }`}
              >
                Process
              </button>
            </div>
          )}

          <div className="px-4 py-3 space-y-3">
            {activeTab === 'result' ? (
              <ResultTab
                synthesis={synthesis}
                perspectives={perspectives}
                crossValidation={crossValidation}
                decisionId={decisionId}
                isDark={isDark}
                textClass={textClass}
                subtextClass={subtextClass}
                advisorBg={advisorBg}
                advisorBorder={advisorBorder}
              />
            ) : (
              <ProcessTab
                process={process!}
                isDark={isDark}
                textClass={textClass}
                subtextClass={subtextClass}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ResultTab({
  synthesis,
  perspectives,
  crossValidation,
  decisionId,
  isDark,
  textClass,
  subtextClass,
  advisorBg,
  advisorBorder,
}: {
  synthesis: string;
  perspectives: Array<{ advisor: string; role: string; content: string }>;
  crossValidation?: MeetingData['crossValidation'];
  decisionId?: string | null;
  isDark?: boolean;
  textClass: string;
  subtextClass: string;
  advisorBg: string;
  advisorBorder: string;
}) {
  return (
    <>
      {/* Advisor Perspectives */}
      {perspectives.length > 0 && (
        <div className="space-y-2">
          <p className={`text-xs font-medium ${subtextClass}`}>
            Advisor Perspectives ({perspectives.length})
          </p>
          <div className="grid gap-2">
            {perspectives.map((p, i) => (
              <div key={i} className={`rounded border ${advisorBorder} ${advisorBg} p-2.5`}>
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
          <div className={`text-sm leading-relaxed ${textClass}`}>{synthesis}</div>
        </div>
      )}

      {/* Cross Validation Details */}
      {crossValidation && (
        <div className="space-y-1.5">
          <p className={`text-xs font-medium ${subtextClass}`}>Cross Validation</p>
          {crossValidation.disagreements.length > 0 && (
            <div>
              <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Disagreements:</span>
              <ul className="mt-0.5 space-y-0.5">
                {crossValidation.disagreements.map((d, i) => (
                  <li key={i} className="text-xs text-amber-700 dark:text-amber-300 ml-3 list-disc">{d}</li>
                ))}
              </ul>
            </div>
          )}
          {crossValidation.gaps.length > 0 && (
            <div>
              <span className="text-xs font-medium text-red-600 dark:text-red-400">Gaps:</span>
              <ul className="mt-0.5 space-y-0.5">
                {crossValidation.gaps.map((g, i) => (
                  <li key={i} className="text-xs text-red-700 dark:text-red-300 ml-3 list-disc">{g}</li>
                ))}
              </ul>
            </div>
          )}
          {crossValidation.agreements.length > 0 && (
            <div>
              <span className="text-xs font-medium text-green-600 dark:text-green-400">Agreements:</span>
              <ul className="mt-0.5 space-y-0.5">
                {crossValidation.agreements.map((a, i) => (
                  <li key={i} className="text-xs text-green-700 dark:text-green-300 ml-3 list-disc">{a}</li>
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
    </>
  );
}

function ProcessTab({
  process,
  isDark,
  textClass,
  subtextClass,
}: {
  process: NonNullable<MeetingData['process']>;
  isDark?: boolean;
  textClass: string;
  subtextClass: string;
}) {
  const brief = parseBrief(process.analysisBrief);
  const steps = [
    {
      title: 'Chair Brief',
      status: 'done' as const,
      content: brief.perspectives?.length
        ? `Generated ${brief.perspectives.length} analysis perspectives: ${brief.perspectives.map((p: any) => p.name ?? p).join(', ')}`
        : 'Analysis brief generated',
    },
    {
      title: 'Advisor Analysis',
      status: 'done' as const,
      content: process.advisorSynthesis
        ? `Advisors produced a multi-perspective synthesis (${process.advisorSynthesis.slice(0, 120)}${process.advisorSynthesis.length > 120 ? '…' : ''})`
        : 'Advisor analysis completed',
    },
    {
      title: 'Reviewer Audit',
      status: process.reviewPassed ? 'done' as const : 'warning' as const,
      content: process.reviewIssues.length > 0
        ? `Found ${process.reviewIssues.length} issue${process.reviewIssues.length !== 1 ? 's' : ''} across ${process.reviewRounds} round${process.reviewRounds !== 1 ? 's' : ''}`
        : `Passed review in ${process.reviewRounds} round${process.reviewRounds !== 1 ? 's' : ''}`,
    },
    {
      title: 'Final Synthesis',
      status: 'done' as const,
      content: 'Cross-validated and synthesized final report',
    },
  ];

  return (
    <div className="space-y-3">
      {/* Timeline */}
      <div className="space-y-0">
        {steps.map((step, i) => (
          <div key={i} className="flex gap-3">
            {/* Step indicator */}
            <div className="flex flex-col items-center">
              <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                step.status === 'done'
                  ? 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400'
                  : 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400'
              }`}>
                {step.status === 'done' ? '✓' : '!'}
              </div>
              {i < steps.length - 1 && (
                <div className={`w-px flex-1 ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`} />
              )}
            </div>
            {/* Step content */}
            <div className="pb-3">
              <p className={`text-xs font-medium ${textClass}`}>{step.title}</p>
              <p className={`text-[10px] ${subtextClass}`}>{step.content}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Review issues detail */}
      {process.reviewIssues.length > 0 && (
        <div className={`rounded border p-2 ${isDark ? 'border-amber-800 bg-amber-900/10' : 'border-amber-200 bg-amber-50'}`}>
          <p className={`text-xs font-medium mb-1 ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>
            Reviewer Issues
          </p>
          <ul className="space-y-1">
            {process.reviewIssues.map((issue, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs">
                <span className={`mt-0.5 inline-block h-1.5 w-1.5 rounded-full ${
                  issue.severity === 'high' ? 'bg-red-500' : issue.severity === 'medium' ? 'bg-amber-500' : 'bg-blue-500'
                }`} />
                <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>{issue.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Raw brief (collapsible) */}
      {process.analysisBrief.length > 0 && (
        <details>
          <summary className={`cursor-pointer text-xs ${subtextClass}`}>Raw chair brief (JSON)</summary>
          <pre className={`mt-1 max-h-32 overflow-auto rounded p-2 text-[10px] ${isDark ? 'bg-gray-900 text-gray-400' : 'bg-gray-100 text-gray-600'}`}>
            {process.analysisBrief}
          </pre>
        </details>
      )}
    </div>
  );
}

function parseBrief(raw: string): { perspectives?: any[] } {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
