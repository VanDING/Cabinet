import { describe, it, expect } from 'vitest';
import {
  DecisionType,
  DecisionLevel,
  DecisionStatus,
  isValidTransition,
  TERMINAL_STATUSES,
  type Decision,
  type DecisionOption,
} from '../decisions';

describe('DecisionType', () => {
  it('has all 5 types', () => {
    expect(DecisionType.Strategic).toBe('strategic');
    expect(DecisionType.Action).toBe('action');
    expect(DecisionType.Execution).toBe('execution');
    expect(DecisionType.Anomaly).toBe('anomaly');
    expect(DecisionType.Evolution).toBe('evolution');
  });
});

describe('DecisionLevel', () => {
  it('has 4 levels in increasing severity', () => {
    expect(DecisionLevel.L0).toBe('L0');
    expect(DecisionLevel.L1).toBe('L1');
    expect(DecisionLevel.L2).toBe('L2');
    expect(DecisionLevel.L3).toBe('L3');
  });
});

describe('DecisionStatus', () => {
  it('has all statuses', () => {
    expect(DecisionStatus.Pending).toBe('pending');
    expect(DecisionStatus.Approved).toBe('approved');
    expect(DecisionStatus.Rejected).toBe('rejected');
    expect(DecisionStatus.Expired).toBe('expired');
    expect(DecisionStatus.Archived).toBe('archived');
  });
});

describe('isValidTransition', () => {
  it('allows pending → approved', () => {
    expect(isValidTransition(DecisionStatus.Pending, DecisionStatus.Approved)).toBe(true);
  });
  it('allows pending → rejected', () => {
    expect(isValidTransition(DecisionStatus.Pending, DecisionStatus.Rejected)).toBe(true);
  });
  it('allows pending → expired', () => {
    expect(isValidTransition(DecisionStatus.Pending, DecisionStatus.Expired)).toBe(true);
  });
  it('allows approved → archived', () => {
    expect(isValidTransition(DecisionStatus.Approved, DecisionStatus.Archived)).toBe(true);
  });
  it('allows rejected → archived', () => {
    expect(isValidTransition(DecisionStatus.Rejected, DecisionStatus.Archived)).toBe(true);
  });
  it('allows expired → archived', () => {
    expect(isValidTransition(DecisionStatus.Expired, DecisionStatus.Archived)).toBe(true);
  });
  it('disallows archived → anything', () => {
    const statuses = Object.values(DecisionStatus);
    for (const status of statuses) {
      expect(isValidTransition(DecisionStatus.Archived, status)).toBe(false);
    }
  });
  it('disallows approved → rejected (no reversal)', () => {
    expect(isValidTransition(DecisionStatus.Approved, DecisionStatus.Rejected)).toBe(false);
  });
  it('disallows pending → archived (skip intermediate)', () => {
    expect(isValidTransition(DecisionStatus.Pending, DecisionStatus.Archived)).toBe(false);
  });
});

describe('TERMINAL_STATUSES', () => {
  it('includes archived only', () => {
    expect(TERMINAL_STATUSES).toEqual([DecisionStatus.Archived]);
  });
});

describe('Decision type', () => {
  it('accepts a valid L2 strategic decision', () => {
    const options: DecisionOption[] = [
      { id: 'opt-1', label: 'Enter market', impact: 'High initial cost, high long-term gain' },
      { id: 'opt-2', label: 'Wait', impact: 'No cost, may miss window' },
    ];
    const decision: Decision = {
      id: 'dec-1',
      projectId: 'proj-1',
      type: DecisionType.Strategic,
      level: DecisionLevel.L2,
      status: DecisionStatus.Pending,
      title: 'Should we enter the baby-products market?',
      description: 'Analysis of market opportunity in maternal-infant sector.',
      options,
      createdAt: new Date(),
    };
    expect(decision.level).toBe('L2');
    expect(decision.options).toHaveLength(2);
    expect(decision.chosenOptionId).toBeUndefined();
  });

  it('resolved decision has chosen option and resolved time', () => {
    const decision: Decision = {
      id: 'dec-2',
      projectId: 'proj-1',
      type: DecisionType.Action,
      level: DecisionLevel.L2,
      status: DecisionStatus.Approved,
      title: 'Approve budget',
      description: 'Approve Q2 budget',
      options: [{ id: 'opt-1', label: 'Approve', impact: 'Budget allocated' }],
      chosenOptionId: 'opt-1',
      captainId: 'captain-1',
      createdAt: new Date('2026-05-01'),
      resolvedAt: new Date('2026-05-02'),
    };
    expect(decision.chosenOptionId).toBe('opt-1');
    expect(decision.resolvedAt).toBeInstanceOf(Date);
  });
});
