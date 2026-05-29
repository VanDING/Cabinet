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
      ? 'text-intent-success'
      : (crossValidation?.coherenceScore ?? 0) >= 0.5
        ? 'text-intent-warning'
        : 'text-intent-danger';

  const hasProcess = !!process && process.analysisBrief.length > 0;

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-accent bg-surface-primary shadow-sm">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between bg-accent-muted px-4 py-2.5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-accent">Meeting</span>
          <span className="text-sm font-medium text-content-primary">{topic}</span>
        </div>
        <div className="flex items-center gap-3">
          {crossValidation && (
            <span className={`font-mono text-xs ${scoreColor}`}>
              Coherence: {(crossValidation.coherenceScore * 100).toFixed(0)}%
            </span>
          )}
          {hasProcess && (
            <span className="text-xs text-content-tertiary">
              {process!.reviewPassed ? '✓ Review passed' : '⚠ Review flagged'}
            </span>
          )}
          <span
            className={`text-xs text-content-tertiary transition-transform ${expanded ? 'rotate-180' : ''}`}
          >
            &#9660;
          </span>
        </div>
      </button>

      {expanded && (
        <div>
          {/* Tabs */}
          {hasProcess && (
            <div className="flex border-b border-border">
              <button
                onClick={() => setActiveTab('result')}
                className={`px-4 py-2 text-xs font-medium transition-colors ${
                  activeTab === 'result'
                    ? 'border-b-2 border-accent text-accent'
                    : 'text-content-tertiary hover:text-content-secondary:text-content-tertiary'
                }`}
              >
                Result
              </button>
              <button
                onClick={() => setActiveTab('process')}
                className={`px-4 py-2 text-xs font-medium transition-colors ${
                  activeTab === 'process'
                    ? 'border-b-2 border-accent text-accent'
                    : 'text-content-tertiary hover:text-content-secondary:text-content-tertiary'
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
          <p className="text-xs font-medium text-content-tertiary">
            Advisor Perspectives ({perspectives.length})
          </p>
          <div className="grid gap-2">
            {perspectives.map((p, i) => (
              <div
                key={i}
                className="rounded border border-border bg-surface-elevated p-2.5"
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-xs font-medium text-content-primary">
                    {p.advisor}
                  </span>
                  <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-xs text-content-secondary">
                    {p.role}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-content-secondary">
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
          <p className="mb-1 text-xs font-medium text-content-tertiary">
            Chair Synthesis
          </p>
          <div className="text-sm leading-relaxed text-content-primary">
            {synthesis}
          </div>
        </div>
      )}

      {/* Cross Validation Details */}
      {crossValidation && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-content-tertiary">
            Cross Validation
          </p>
          {crossValidation.disagreements.length > 0 && (
            <div>
              <span className="text-xs font-medium text-intent-warning">
                Disagreements:
              </span>
              <ul className="mt-0.5 space-y-0.5">
                {crossValidation.disagreements.map((d, i) => (
                  <li
                    key={i}
                    className="ml-3 list-disc text-xs text-intent-warning"
                  >
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {crossValidation.gaps.length > 0 && (
            <div>
              <span className="text-xs font-medium text-intent-danger">Gaps:</span>
              <ul className="mt-0.5 space-y-0.5">
                {crossValidation.gaps.map((g, i) => (
                  <li key={i} className="ml-3 list-disc text-xs text-intent-danger">
                    {g}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {crossValidation.agreements.length > 0 && (
            <div>
              <span className="text-xs font-medium text-intent-success">
                Agreements:
              </span>
              <ul className="mt-0.5 space-y-0.5">
                {crossValidation.agreements.map((a, i) => (
                  <li
                    key={i}
                    className="ml-3 list-disc text-xs text-intent-success"
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
        <div className="rounded border border-intent-success bg-intent-success-muted px-3 py-2 text-xs text-intent-success">
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
                    ? 'bg-intent-success-muted text-intent-success'
                    : 'bg-intent-warning-muted text-intent-warning'
                }`}
              >
                {step.status === 'done' ? '✓' : '!'}
              </div>
              {i < steps.length - 1 && (
                <div className="w-px flex-1 bg-surface-muted" />
              )}
            </div>
            {/* Step content */}
            <div className="pb-3">
              <p className="text-xs font-medium text-content-primary">
                {step.title}
              </p>
              <p className="text-[10px] text-content-tertiary">{step.content}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Review issues detail */}
      {process.reviewIssues.length > 0 && (
        <div className="rounded border border-intent-warning bg-intent-warning-muted p-2">
          <p className="mb-1 text-xs font-medium text-intent-warning">
            Reviewer Issues
          </p>
          <ul className="space-y-1">
            {process.reviewIssues.map((issue, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs">
                <span
                  className={`mt-0.5 inline-block h-1.5 w-1.5 rounded-full ${
                    issue.severity === 'high'
                      ? 'bg-intent-danger'
                      : issue.severity === 'medium'
                        ? 'bg-intent-warning'
                        : 'bg-accent'
                  }`}
                />
                <span className="text-content-secondary">{issue.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Raw brief (collapsible) */}
      {process.analysisBrief.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-content-tertiary">
            Raw chair brief (JSON)
          </summary>
          <pre className="mt-1 max-h-32 overflow-auto rounded bg-surface-muted p-2 text-[10px] text-content-secondary">
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
