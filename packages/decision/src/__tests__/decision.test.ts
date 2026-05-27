// packages/decision/src/__tests__/decision.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DecisionStateMachine } from '../state-machine.js';
import { LevelClassifier } from '../level-classifier.js';
import { DecisionService } from '../decision-service.js';
import { type DecisionStore, DelegationTier } from '@cabinet/types';

describe('DecisionStateMachine', () => {
  let sm: DecisionStateMachine;
  beforeEach(() => {
    sm = new DecisionStateMachine();
  });

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
  beforeEach(() => {
    classifier = new LevelClassifier();
  });

  const baseInput = {
    scopeDescription: 'test',
    isCrossSession: false,
    optionCount: 1,
    estimatedCostUsd: 0,
    involvesFunds: false,
    involvesPermissions: false,
    involvesDataDeletion: false,
    involvesOrgConfig: false,
  };

  it('classifies L3 for org config changes', () => {
    expect(classifier.classify({ ...baseInput, involvesOrgConfig: true })).toBe('L3');
  });

  it('classifies L3 for high cost', () => {
    expect(classifier.classify({ ...baseInput, estimatedCostUsd: 2.0 })).toBe('L3');
  });

  it('classifies L2 for cross-session', () => {
    expect(classifier.classify({ ...baseInput, isCrossSession: true })).toBe('L2');
  });

  it('classifies L1 for low-risk within session', () => {
    expect(classifier.classify({ ...baseInput, optionCount: 2, estimatedCostUsd: 0.05 })).toBe(
      'L1',
    );
  });

  it('escalates on uncertainty', () => {
    expect(classifier.classify({ ...baseInput, optionCount: 5, isCrossSession: true })).toBe('L2');
  });
});

describe('DecisionService tier awareness', () => {
  const mockStore: DecisionStore = {
    save: () => {},
    get: () => null,
    listByProject: () => [],
    listPending: () => [],
  };

  function createService(tier: DelegationTier) {
    return new DecisionService(
      new DecisionStateMachine(),
      new LevelClassifier(),
      { log: () => {} } as any,
      { escalate: () => {} } as any,
      mockStore,
      undefined,
      () => tier,
    );
  }

  const baseInput = {
    id: 'd1',
    projectId: 'p1',
    type: 'action' as const,
    title: 'Test',
    description: 'Test decision',
    options: [{ id: 'o1', label: 'Yes', impact: 'low' }],
    classification: {
      scopeDescription: 'test',
      isCrossSession: false,
      optionCount: 1,
      estimatedCostUsd: 0,
      involvesFunds: false,
      involvesPermissions: false,
      involvesDataDeletion: false,
      involvesOrgConfig: false,
    },
  };

  it('T0 only auto-approves L0', () => {
    const svc = createService(DelegationTier.CaptainReview);
    expect(svc.getAutoApproveMaxLevel()).toBe('L0');
    expect(svc.shouldAutoApprove('L0')).toBe(true);
    expect(svc.shouldAutoApprove('L1')).toBe(false);
    expect(svc.shouldAutoApprove('L2')).toBe(false);
    expect(svc.shouldAutoApprove('L3')).toBe(false);
  });

  it('T1 auto-approves up to L1', () => {
    const svc = createService(DelegationTier.StrategicGuard);
    expect(svc.getAutoApproveMaxLevel()).toBe('L1');
    expect(svc.shouldAutoApprove('L0')).toBe(true);
    expect(svc.shouldAutoApprove('L1')).toBe(true);
    expect(svc.shouldAutoApprove('L2')).toBe(false);
    expect(svc.shouldAutoApprove('L3')).toBe(false);
  });

  it('T2 auto-approves up to L2', () => {
    const svc = createService(DelegationTier.TrustedMode);
    expect(svc.getAutoApproveMaxLevel()).toBe('L2');
    expect(svc.shouldAutoApprove('L0')).toBe(true);
    expect(svc.shouldAutoApprove('L1')).toBe(true);
    expect(svc.shouldAutoApprove('L2')).toBe(true);
    expect(svc.shouldAutoApprove('L3')).toBe(false);
  });

  it('T3 auto-approves all levels', () => {
    const svc = createService(DelegationTier.FullAutonomy);
    expect(svc.getAutoApproveMaxLevel()).toBe('L3');
    expect(svc.shouldAutoApprove('L0')).toBe(true);
    expect(svc.shouldAutoApprove('L1')).toBe(true);
    expect(svc.shouldAutoApprove('L2')).toBe(true);
    expect(svc.shouldAutoApprove('L3')).toBe(true);
  });

  it('creates decision with correct auto-approval at T1', () => {
    const svc = createService(DelegationTier.StrategicGuard);
    const decision = svc.create({
      ...baseInput,
      classification: { ...baseInput.classification, estimatedCostUsd: 0.05, optionCount: 2 },
    });
    expect(decision.status).toBe('approved');
    expect(decision.captainId).toBe('system');
  });

  it('creates decision without auto-approval when above tier max', () => {
    const svc = createService(DelegationTier.StrategicGuard);
    const decision = svc.create({
      ...baseInput,
      classification: { ...baseInput.classification, involvesOrgConfig: true },
    });
    expect(decision.status).toBe('pending');
  });
});
