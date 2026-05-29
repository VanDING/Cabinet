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
}

export function MeetingCard({ data }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<'result' | 'process'>('result');

  const { topic, synthesis, perspectives, crossValidation, decisionId, process } = data;

  const scoreColor =
    (crossValidation?.coherenceScore ?? 0) >= 0.7
      ? 'text-green-600'
      : (crossValidation?.coherenceScore ?? 0) >= 0.5
        ? 'text-amber-600'
        : 'text-red-600';

  const hasProcess = !!process && process.analysisBrief.length > 0;

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-blue-200 bg-white shadow-sm">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between bg-blue-50 px-4 py-2.5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-blue-700">Meeting</span>
          <span className="text-sm font-medium text-gray-800">{topic}</span>
        </div>
        <div className="flex items-center gap-3">
          {crossValidation && (
            <span className={`font-mono text-xs ${scoreColor}`}>
              Coherence: {(crossValidation.coherenceScore * 100).toFixed(0)}%
            </span>
          )}
          {hasProcess && (
            <span className="text-xs text-gray-500">
              {process!.reviewPassed ? '✓ Review passed' : '⚠ Review flagged'}
            </span>
          )}
          <span
            className={`text-xs text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
          >
            &#9660;
          </span>
        </div>
      </button>

      {expanded && (
        <div>
          {/* Tabs */}
          {hasProcess && (
            <div className="flex border-b border-gray-200">
              <button
                onClick={() => setActiveTab('result')}
                className={`px-4 py-2 text-xs font-medium transition-colors ${
                  activeTab === 'result'
                    ? 'border-b-2 border-blue-500 text-blue-600'
                    : 'text-gray-500 hover:text-gray-700:text-gray-300'
                }`}
              >
                Result
              </button>
              <button
                onClick={() => setActiveTab('process')}
                className={`px-4 py-2 text-xs font-medium transition-colors ${
                  activeTab === 'process'
                    ? 'border-b-2 border-blue-500 text-blue-600'
                    : 'text-gray-500 hover:text-gray-700:text-gray-300'
                }`}
              >
                Process
              </button>
            </div>
          )}

          <div className="space-y-3 px-4 py-3">
            {activeTab === 'result' ? (
              <ResultTab
                synthesis={synthesis}
                perspectives={perspectives}
                crossValidation={crossValidation}
                decisionId={decisionId}
              />
            ) : (
              <ProcessTab process={process!} />
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
}: {
  synthesis: string;
  perspectives: Array<{ advisor: string; role: string; content: string }>;
  crossValidation?: MeetingData['crossValidation'];
  decisionId?: string | null;
}) {
  return (
    <>
      {/* Advisor Perspectives */}
      {perspectives.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-500">
            Advisor Perspectives ({perspectives.length})
          </p>
          <div className="grid gap-2">
            {perspectives.map((p, i) => (
              <div
                key={i}
                className="rounded border border-gray-200 bg-gray-50 p-2.5"
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-800">
                    {p.advisor}
                  </span>
                  <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                    {p.role}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-gray-600">
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
          <p className="mb-1 text-xs font-medium text-gray-500">
            Chair Synthesis
          </p>
          <div className="text-sm leading-relaxed text-gray-800">
            {synthesis}
          </div>
        </div>
      )}

      {/* Cross Validation Details */}
      {crossValidation && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-gray-500">
            Cross Validation
          </p>
          {crossValidation.disagreements.length > 0 && (
            <div>
              <span className="text-xs font-medium text-amber-600">
                Disagreements:
              </span>
              <ul className="mt-0.5 space-y-0.5">
                {crossValidation.disagreements.map((d, i) => (
                  <li
                    key={i}
                    className="ml-3 list-disc text-xs text-amber-700"
                  >
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {crossValidation.gaps.length > 0 && (
            <div>
              <span className="text-xs font-medium text-red-600">Gaps:</span>
              <ul className="mt-0.5 space-y-0.5">
                {crossValidation.gaps.map((g, i) => (
                  <li key={i} className="ml-3 list-disc text-xs text-red-700">
                    {g}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {crossValidation.agreements.length > 0 && (
            <div>
              <span className="text-xs font-medium text-green-600">
                Agreements:
              </span>
              <ul className="mt-0.5 space-y-0.5">
                {crossValidation.agreements.map((a, i) => (
                  <li
                    key={i}
                    className="ml-3 list-disc text-xs text-green-700"
                  >
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
        <div className="rounded border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-700">
          Decision <code className="font-mono">{decisionId}</code> was auto-extracted from this
          meeting. Review it in the Office or Decision Room.
        </div>
      )}
    </>
  );
}

function ProcessTab({
  process,
}: {
  process: NonNullable<MeetingData['process']>;
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
      status: process.reviewPassed ? ('done' as const) : ('warning' as const),
      content:
        process.reviewIssues.length > 0
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
              <div
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                  step.status === 'done'
                    ? 'bg-green-100 text-green-600'
                    : 'bg-amber-100 text-amber-600'
                }`}
              >
                {step.status === 'done' ? '✓' : '!'}
              </div>
              {i < steps.length - 1 && (
                <div className="w-px flex-1 bg-gray-200" />
              )}
            </div>
            {/* Step content */}
            <div className="pb-3">
              <p className="text-xs font-medium text-gray-800">
                {step.title}
              </p>
              <p className="text-[10px] text-gray-500">{step.content}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Review issues detail */}
      {process.reviewIssues.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 p-2">
          <p className="mb-1 text-xs font-medium text-amber-700">
            Reviewer Issues
          </p>
          <ul className="space-y-1">
            {process.reviewIssues.map((issue, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs">
                <span
                  className={`mt-0.5 inline-block h-1.5 w-1.5 rounded-full ${
                    issue.severity === 'high'
                      ? 'bg-red-500'
                      : issue.severity === 'medium'
                        ? 'bg-amber-500'
                        : 'bg-blue-500'
                  }`}
                />
                <span className="text-gray-700">{issue.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Raw brief (collapsible) */}
      {process.analysisBrief.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-gray-500">
            Raw chair brief (JSON)
          </summary>
          <pre className="mt-1 max-h-32 overflow-auto rounded bg-gray-100 p-2 text-[10px] text-gray-600">
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
