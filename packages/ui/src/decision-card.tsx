import { useState } from 'react';
import type { Decision } from '@cabinet/types';
import { Card, CardContent, CardFooter } from
  '../../../apps/desktop/src/components/ui/card.js';
import { Badge } from
  '../../../apps/desktop/src/components/ui/badge.js';
import { Button } from
  '../../../apps/desktop/src/components/ui/button.js';
import { RadioGroup, RadioGroupItem } from
  '../../../apps/desktop/src/components/ui/radio-group.js';

export interface DecisionCardProps {
  decision: Decision;
  onApprove?: (id: string, optionId: string) => void;
  onReject?: (id: string) => void;
  onViewDetails?: (id: string) => void;
  variant?: 'compact' | 'full';
}

const levelColors: Record<string, string> = {
  L0: 'bg-surface-muted text-content-secondary',
  L1: 'bg-intent-success-muted text-intent-success',
  L2: 'bg-intent-warning-muted text-intent-warning',
  L3: 'bg-intent-danger-muted text-intent-danger',
};

export function DecisionCard({
  decision,
  onApprove,
  onReject,
  onViewDetails,
  variant = 'compact',
}: DecisionCardProps) {
  const [selectedOptionId, setSelectedOptionId] = useState(
    decision.chosenOptionId ?? decision.options[0]?.id ?? '',
  );

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent>
        <div className="mb-2 flex items-center justify-between">
          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${levelColors[decision.level] ?? 'bg-surface-muted text-content-secondary'}`}>
            {decision.level}
          </span>
          <span className="text-content-tertiary text-xs">{decision.type}</span>
        </div>
        <h3 className="text-content-primary mb-1 font-medium">{decision.title}</h3>
        <p className="text-content-tertiary mb-3 line-clamp-2 text-sm">{decision.description}</p>

        {variant === 'full' && decision.options.length > 0 && (
          <RadioGroup value={selectedOptionId} onValueChange={setSelectedOptionId} className="mb-3">
            {decision.options.map((opt) => (
              <label key={opt.id} className="flex items-start gap-2 py-1.5 text-sm">
                <RadioGroupItem value={opt.id} className="mt-0.5" />
                <div>
                  <div className="text-content-secondary font-medium">{opt.label}</div>
                  <div className="text-content-tertiary text-xs">{opt.impact}</div>
                </div>
              </label>
            ))}
          </RadioGroup>
        )}

        <CardFooter className="flex gap-2 px-0">
          {onApprove && decision.status === 'pending' && (
            <Button variant="default" onClick={() => onApprove(decision.id, selectedOptionId)}>
              Approve
            </Button>
          )}
          {onReject && decision.status === 'pending' && (
            <Button variant="destructive" onClick={() => onReject(decision.id)}>
              Reject
            </Button>
          )}
          {onViewDetails && (
            <Button variant="outline" onClick={() => onViewDetails(decision.id)}>
              Details
            </Button>
          )}
        </CardFooter>
      </CardContent>
    </Card>
  );
}
