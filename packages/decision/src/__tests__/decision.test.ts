// packages/decision/src/__tests__/decision.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DecisionStateMachine } from '../state-machine.js';
import { LevelClassifier } from '../level-classifier.js';

describe('DecisionStateMachine', () => {
  let sm: DecisionStateMachine;
  beforeEach(() => { sm = new DecisionStateMachine(); });

  it('initial status is pending', () => {
    expect(sm.getInitialStatus()).toBe('pending');
  });

  it('allows pending -> approved', () => {
    expect(sm.transition('pending', 'approve')).toBe('approved');
  });

  it('allows pending -> rejected', () => {
    expect(sm.transition('pending', 'reject')).toBe('rejected');
  });

  it('allows approved -> archived', () => {
    expect(sm.transition('approved', 'archive')).toBe('archived');
  });

  it('throws on invalid transition', () => {
    expect(() => sm.transition('archived', 'approve')).toThrow('Invalid transition');
  });

  it('identifies terminal statuses', () => {
    expect(sm.isTerminal('archived')).toBe(true);
    expect(sm.isTerminal('pending')).toBe(false);
  });
});

describe('LevelClassifier', () => {
  let classifier: LevelClassifier;
  beforeEach(() => { classifier = new LevelClassifier(); });

  const baseInput = {
    scopeDescription: 'test', isCrossSession: false, optionCount: 1,
    estimatedCostUsd: 0, involvesFunds: false, involvesPermissions: false,
    involvesDataDeletion: false, involvesOrgConfig: false,
  };

  it('classifies L3 for org config changes', () => {
    expect(classifier.classify({ ...baseInput, involvesOrgConfig: true })).toBe('L3');
  });

  it('classifies L3 for high cost', () => {
    expect(classifier.classify({ ...baseInput, estimatedCostUsd: 2.00 })).toBe('L3');
  });

  it('classifies L2 for cross-session', () => {
    expect(classifier.classify({ ...baseInput, isCrossSession: true })).toBe('L2');
  });

  it('classifies L1 for low-risk within session', () => {
    expect(classifier.classify({ ...baseInput, optionCount: 2, estimatedCostUsd: 0.05 })).toBe('L1');
  });

  it('escalates on uncertainty', () => {
    expect(classifier.classify({ ...baseInput, optionCount: 5, isCrossSession: true })).toBe('L2');
  });
});
