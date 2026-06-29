import { useState } from 'react';
import type { StructuredOutput, DeliverableData } from '@cabinet/types';
import { Card, CardContent, CardFooter } from
  '../../../apps/desktop/src/components/ui/card.js';
import { Button } from
  '../../../apps/desktop/src/components/ui/button.js';

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
  output, variant = 'compact', onApprove, onRequestChanges, onDiscuss, onExpand,
}: DeliverableCardProps) {
  const data = getData(output);
  const [expanded, setExpanded] = useState(false);
  const isResolved = output.status !== 'proposed';

  const statusBar = isResolved ? (
    <div className={`mb-2 rounded px-3 py-1.5 text-xs font-medium ${
      output.status === 'accepted'
        ? 'bg-[var(--intent-success-muted)] text-[var(--intent-success)]'
        : 'bg-[var(--accent-muted)] text-[var(--accent)]'
    }`}>
      {output.status === 'accepted' ? '✅ Approved · Archived' : '↩ Changes requested'}
    </div>
  ) : null;

  const generationInfo = data.generationTimeMs !== undefined
    ? `⏱ Generated in ${Math.round(data.generationTimeMs / 1000)}s`
    : null;

  return (
    <Card className="my-3">
      <CardContent>
        {statusBar}
        <div className="mb-2 flex items-center justify-between">
          <span className="text-content-primary text-sm font-semibold">📄 {data.title}</span>
          {generationInfo && <span className="text-content-tertiary text-xs">{generationInfo}</span>}
        </div>
        {data.sources && data.sources.length > 0 && (
          <p className="text-content-tertiary mb-2 text-xs">📊 Sources: {data.sources.join(', ')}</p>
        )}

        {variant === 'full' ? (
          <div className="text-content-secondary mb-3 text-sm">
            <div className={`whitespace-pre-wrap ${!expanded ? 'line-clamp-6' : ''}`}>
              {data.fullContent || data.summary}
            </div>
            {!expanded && (
              <Button variant="link" size="xs" className="text-xs text-[var(--accent)]" onClick={() => setExpanded(true)}>
                Read more ↓
              </Button>
            )}
            {expanded && (
              <Button variant="link" size="xs" className="text-xs text-[var(--accent)]" onClick={() => setExpanded(false)}>
                Show less ↑
              </Button>
            )}
          </div>
        ) : (
          <p className="text-content-secondary mb-1 line-clamp-3 text-xs">{data.summary}</p>
        )}

        <CardFooter className="flex flex-wrap gap-2 px-0">
          {onExpand && (
            <Button variant="outline" size="xs" onClick={() => onExpand(output.id)}>
              📖 Expand full text
            </Button>
          )}
          {!isResolved && onApprove && (
            <Button size="xs" onClick={() => onApprove(output.id)}>✅ Approve</Button>
          )}
          {onRequestChanges && (
            <Button variant="outline" size="xs" onClick={() => onRequestChanges(output.id)}>
              ↩ Request Changes
            </Button>
          )}
          {onDiscuss && (
            <Button variant="ghost" size="xs" onClick={() => onDiscuss(output.id)}>
              💬 Discuss
            </Button>
          )}
        </CardFooter>
      </CardContent>
    </Card>
  );
}
