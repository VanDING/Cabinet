import { useState } from 'react';
import type { StructuredOutput, DecisionProposalData } from '@cabinet/types';
import { Card, CardContent, CardFooter } from
  '../../../apps/desktop/src/components/ui/card.js';
import { Badge } from
  '../../../apps/desktop/src/components/ui/badge.js';
import { Button } from
  '../../../apps/desktop/src/components/ui/button.js';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '../../../apps/desktop/src/components/ui/table.js';

export interface DecisionProposalCardProps {
  output: StructuredOutput;
  variant?: 'compact' | 'full';
  onAdopt?: (outputId: string, optionLabel: string) => void;
  onRequestMore?: (outputId: string) => void;
  onReject?: (outputId: string) => void;
  onViewDetails?: (outputId: string) => void;
}

function getData(output: StructuredOutput): DecisionProposalData {
  return output.data as unknown as DecisionProposalData;
}

const priorityColors: Record<string, string> = {
  high: 'text-[var(--intent-danger)]',
  medium: 'text-[var(--intent-warning)]',
  low: 'text-[var(--content-secondary)]',
};
const priorityBgColors: Record<string, string> = {
  high: 'bg-[var(--intent-danger-muted)]',
  medium: 'bg-[var(--intent-warning-muted)]',
  low: 'bg-[var(--surface-muted)]',
};

const priorityLabels: Record<string, string> = {
  high: 'High', medium: 'Medium', low: 'Low',
};

export function DecisionProposalCard({
  output, variant = 'compact', onAdopt, onRequestMore, onReject, onViewDetails,
}: DecisionProposalCardProps) {
  const data = getData(output);
  const [selectedOption, setSelectedOption] = useState(data.recommendation);
  const isResolved = output.status !== 'proposed';

  const statusBar = isResolved ? (
    <div className={`mb-2 rounded px-3 py-1.5 text-xs font-medium ${
      output.status === 'accepted'
        ? 'bg-[var(--intent-success-muted)] text-[var(--intent-success)]'
        : output.status === 'rejected'
          ? 'bg-[var(--intent-danger-muted)] text-[var(--intent-danger)]'
          : 'bg-[var(--accent-muted)] text-[var(--accent)]'
    }`}>
      {output.status === 'accepted' ? `✅ Adopted · ${data.recommendation}` :
       output.status === 'rejected' ? '❌ Rejected' : `↩ Modified · ${data.recommendation}`}
    </div>
  ) : null;

  if (variant === 'compact') {
    return (
      <Card className="my-3">
        <CardContent>
          {statusBar}
          <div className="mb-2 flex items-center justify-between">
            <span className="text-content-primary text-sm font-semibold">📋 {data.title}</span>
            <Badge className={`${priorityBgColors[data.priority] ?? ''} ${priorityColors[data.priority] ?? ''}`}>
              {priorityLabels[data.priority] ?? data.priority}
            </Badge>
          </div>
          <p className="text-content-secondary mb-1 text-xs">{data.summary}</p>
          <p className="text-content-tertiary mb-2 text-xs">
            Recommendation: <span className="text-content-primary font-medium">{data.recommendation}</span>
          </p>
          {!isResolved && (
            <CardFooter className="flex gap-2 px-0">
              {onAdopt && <Button onClick={() => onAdopt(output.id, selectedOption)}>✅ Adopt {data.recommendation}</Button>}
              {onRequestMore && <Button variant="outline" onClick={() => onRequestMore(output.id)}>↩ Request More</Button>}
              {onReject && <Button variant="destructive" onClick={() => onReject(output.id)}>❌ Reject</Button>}
            </CardFooter>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="my-3">
      <CardContent>
        {statusBar}
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-content-primary font-semibold">📋 {data.title}</h3>
          <Badge className={`${priorityBgColors[data.priority] ?? ''} ${priorityColors[data.priority] ?? ''}`}>
            {priorityLabels[data.priority] ?? data.priority}
          </Badge>
        </div>
        <p className="text-content-secondary mb-3 text-sm">{data.summary}</p>

        <div className="mb-3 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Dimension</TableHead>
                {data.options.map(opt => (
                  <TableHead key={opt.label} className="text-center text-xs">{opt.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.dimensions.map(dim => (
                <TableRow key={dim}>
                  <TableCell className="text-xs text-content-primary">{dim}</TableCell>
                  {data.options.map(opt => {
                    const score = opt.scores[dim];
                    const isMax = score !== undefined && data.options.every(o => (o.scores[dim] ?? 0) <= score);
                    return (
                      <TableCell key={opt.label} className={`text-center text-xs ${isMax ? 'font-semibold text-[var(--intent-success)]' : 'text-content-tertiary'}`}>
                        {score !== undefined ? `${score}/10` : '-'}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <p className="text-accent mb-3 text-xs">
          AI recommends: <span className="font-semibold">{data.recommendation}</span>
        </p>

        {!isResolved && (
          <CardFooter className="flex gap-2 px-0">
            {onAdopt && <Button onClick={() => onAdopt(output.id, selectedOption)}>✅ Adopt</Button>}
            {onRequestMore && <Button variant="outline" onClick={() => onRequestMore(output.id)}>↩ Request More</Button>}
            {onReject && <Button variant="destructive" onClick={() => onReject(output.id)}>❌ Reject</Button>}
          </CardFooter>
        )}
        {onViewDetails && (
          <Button variant="ghost" size="xs" onClick={() => onViewDetails(output.id)}>
            View details →
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
