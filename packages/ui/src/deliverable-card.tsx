import { useState } from 'react';
import type { StructuredOutput, DeliverableData } from '@cabinet/types';

export interface DeliverableCardProps {
  output: StructuredOutput;
  variant?: 'compact' | 'full';
  onApprove?: (outputId: string) => void;
  onRequestChanges?: (outputId: string) => void;
  onDiscuss?: (outputId: string) => void;
  onExpand?: (outputId: string) => void;
}

function getData(output: StructuredOutput): DeliverableData {
  return output.data as unknown as DeliverableData;
}

export function DeliverableCard({
  output,
  variant = 'compact',
  onApprove,
  onRequestChanges,
  onDiscuss,
  onExpand,
}: DeliverableCardProps) {
  const data = getData(output);
  const [expanded, setExpanded] = useState(false);
  const isResolved = output.status !== 'proposed';

  const statusBar = isResolved ? (
    <div
      className={`mb-2 rounded px-3 py-1.5 text-xs font-medium ${
        output.status === 'accepted'
          ? 'bg-intent-success-muted text-intent-success'
          : output.status === 'rejected'
            ? 'bg-intent-danger-muted text-intent-danger'
            : 'bg-intent-info-muted text-intent-info'
      }`}
    >
      {output.status === 'accepted' ? '✅ Approved · Archived' : '↩ Changes requested'}
    </div>
  ) : null;

  const generationInfo =
    data.generationTimeMs !== undefined
      ? `⏱ Generated in ${Math.round(data.generationTimeMs / 1000)}s`
      : null;

  if (variant === 'compact') {
    return (
      <div className="border-border bg-surface-primary my-3 rounded-lg border p-3">
        {statusBar}
        <div className="mb-2 flex items-center justify-between">
          <span className="text-content-primary text-sm font-semibold">📄 {data.title}</span>
          {generationInfo && (
            <span className="text-content-tertiary text-xs">{generationInfo}</span>
          )}
        </div>
        <p className="text-content-secondary mb-1 line-clamp-3 text-xs">{data.summary}</p>
        {data.sources && data.sources.length > 0 && (
          <p className="text-content-tertiary mb-2 text-xs">
            📊 Sources: {data.sources.join(', ')}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {onExpand && (
            <button
              onClick={() => onExpand(output.id)}
              className="border-border text-content-secondary hover:bg-surface-elevated rounded border px-3 py-1.5 text-xs"
            >
              📖 Expand full text
            </button>
          )}
          {!isResolved && (
            <>
              {onApprove && (
                <button
                  onClick={() => onApprove(output.id)}
                  className="bg-intent-success rounded px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                >
                  ✅ Approve
                </button>
              )}
              {onRequestChanges && (
                <button
                  onClick={() => onRequestChanges(output.id)}
                  className="text-intent-warning hover:bg-intent-warning-muted rounded px-3 py-1.5 text-xs"
                >
                  ↩ Request Changes
                </button>
              )}
              {onDiscuss && (
                <button
                  onClick={() => onDiscuss(output.id)}
                  className="text-content-tertiary hover:text-content-secondary rounded px-3 py-1.5 text-xs"
                >
                  💬 Discuss
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="border-border bg-surface-primary my-3 rounded-lg border p-4">
      {statusBar}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-content-primary font-semibold">📄 {data.title}</h3>
        {generationInfo && <span className="text-content-tertiary text-xs">{generationInfo}</span>}
      </div>
      {data.sources && data.sources.length > 0 && (
        <p className="text-content-tertiary mb-2 text-xs">📊 Sources: {data.sources.join(', ')}</p>
      )}
      <div className="text-content-secondary mb-3 text-sm">
        {expanded ? (
          <div className="whitespace-pre-wrap">{data.fullContent}</div>
        ) : (
          <>
            <p className="line-clamp-6">{data.fullContent || data.summary}</p>
            <button
              onClick={() => setExpanded(true)}
              className="text-accent mt-1 text-xs hover:underline"
            >
              Read more ↓
            </button>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {!isResolved && (
          <>
            {onApprove && (
              <button
                onClick={() => onApprove(output.id)}
                className="bg-intent-success rounded px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                ✅ Approve
              </button>
            )}
            {onRequestChanges && (
              <button
                onClick={() => onRequestChanges(output.id)}
                className="border-border text-intent-warning hover:bg-intent-warning-muted rounded border px-3 py-1.5 text-sm"
              >
                ↩ Request Changes
              </button>
            )}
            {onDiscuss && (
              <button
                onClick={() => onDiscuss(output.id)}
                className="text-content-tertiary hover:text-content-secondary rounded px-3 py-1.5 text-sm"
              >
                💬 Discuss
              </button>
            )}
          </>
        )}
        {onExpand && (
          <button
            onClick={() => onExpand(output.id)}
            className="border-border text-content-secondary hover:bg-surface-elevated rounded border px-3 py-1.5 text-sm"
          >
            📥 Export / Share
          </button>
        )}
      </div>
    </div>
  );
}
