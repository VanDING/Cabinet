import {
  DecisionStatus,
  DecisionType,
  type Decision,
  type DecisionLevel,
  type DecisionStore,
  type DelegationTier,
} from '@cabinet/types';
import { DecisionStateMachine } from './state-machine.js';
import { LevelClassifier, type ClassificationInput } from './level-classifier.js';
import { AuditLogger } from './audit-log.js';
import { EscalationService } from './escalation.js';
import type { PolicyEngine } from './policy-engine.js';

export interface CreateDecisionInput {
  id: string;
  projectId: string;
  type: DecisionType;
  title: string;
  description: string;
  options: { id: string; label: string; impact: string }[];
  classification: ClassificationInput;
  captainId?: string;
}

export type DecisionResolvedCallback = (
  decisionId: string,
  action: 'approved' | 'rejected',
  title: string,
  chosenOptionId?: string,
  captainId?: string,
) => void;

export class DecisionService {
  constructor(
    private readonly stateMachine: DecisionStateMachine,
    private readonly classifier: LevelClassifier,
    private readonly auditLog: AuditLogger,
    private readonly escalation: EscalationService,
    private readonly store: DecisionStore,
    private readonly onResolved?: DecisionResolvedCallback,
    private readonly getCurrentTier?: () => DelegationTier,
    private readonly policyEngine?: PolicyEngine,
  ) {}

  /** Map current delegation tier to the maximum decision level that can be auto-approved. */
  getAutoApproveMaxLevel(): DecisionLevel {
    const tier = this.getCurrentTier?.() ?? 'T1';
    const map: Record<DelegationTier, DecisionLevel> = {
      T0: 'L0',
      T1: 'L1',
      T2: 'L2',
      T3: 'L3',
    };
    return map[tier];
  }

  /** Check whether a decision level should be auto-approved at the current delegation tier. */
  shouldAutoApprove(level: DecisionLevel): boolean {
    const maxLevel = this.getAutoApproveMaxLevel();
    const order: Record<DecisionLevel, number> = { L0: 0, L1: 1, L2: 2, L3: 3 };
    return order[level] <= order[maxLevel];
  }

  create(input: CreateDecisionInput): Decision {
    const level = this.classifier.classify(input.classification);
    const decision: Decision = {
      id: input.id,
      projectId: input.projectId,
      type: input.type,
      level: level as DecisionLevel,
      status: DecisionStatus.Pending,
      title: input.title,
      description: input.description,
      options: input.options,
      createdAt: new Date(),
    };

    this.store.save(decision);
    this.auditLog.log({
      entityType: 'decision',
      entityId: decision.id,
      action: 'created',
      actor: input.captainId ?? 'system',
      changes: { level, title: input.title },
    });

    // Policy check: override auto-approval if it violates mission constraints
    const policyCheck = this.policyEngine?.checkDecision(decision);
    if (policyCheck && !policyCheck.allowed) {
      decision.status = DecisionStatus.Pending;
      this.auditLog.log({
        entityType: 'decision',
        entityId: decision.id,
        action: 'policy_blocked',
        actor: 'system',
        changes: { reason: policyCheck.reason },
      });
    }

    // Auto-process based on delegation tier (through state machine for audit trail)
    if (this.shouldAutoApprove(level as DecisionLevel) && (!policyCheck || policyCheck.allowed)) {
      const approvedStatus = this.stateMachine.transition(decision.status, 'approve');
      decision.status = approvedStatus as typeof decision.status;
      decision.resolvedAt = new Date();
      decision.captainId = 'system';
      this.store.save(decision);
      this.auditLog.log({
        entityType: 'decision',
        entityId: decision.id,
        action: 'auto_approved',
        actor: 'system',
        changes: {
          level,
          status: approvedStatus,
          reason: `Auto-approved up to ${this.getAutoApproveMaxLevel()}`,
        },
      });
      // Notify preference learner and workflow hooks (same as manual approve)
      this.onResolved?.(decision.id, 'approved', decision.title, undefined, 'system');
    }

    // Escalate L3
    if (level === 'L3') {
      this.escalation.escalate(decision.id, decision.title, level);
    }

    return decision;
  }

  approve(decisionId: string, captainId: string, chosenOptionId: string): Decision {
    const decision = this.store.get(decisionId);
    if (!decision) throw new Error(`Decision not found: ${decisionId}`);

    const newStatus = this.stateMachine.transition(decision.status, 'approve');

    const updated: Decision = {
      ...decision,
      status: newStatus as any,
      chosenOptionId,
      captainId,
      resolvedAt: new Date(),
    };

    this.store.save(updated);
    this.auditLog.log({
      entityType: 'decision',
      entityId: decisionId,
      action: 'approved',
      actor: captainId,
      changes: { chosenOptionId, status: newStatus },
    });

    // Notify preference learner
    this.onResolved?.(decisionId, 'approved', updated.title, chosenOptionId, captainId);

    return updated;
  }

  reject(decisionId: string, captainId: string): Decision {
    const decision = this.store.get(decisionId);
    if (!decision) throw new Error(`Decision not found: ${decisionId}`);

    const newStatus = this.stateMachine.transition(decision.status, 'reject');

    const updated: Decision = {
      ...decision,
      status: newStatus as any,
      captainId,
      resolvedAt: new Date(),
    };

    this.store.save(updated);
    this.auditLog.log({
      entityType: 'decision',
      entityId: decisionId,
      action: 'rejected',
      actor: captainId,
      changes: { status: newStatus },
    });

    // Notify preference learner
    this.onResolved?.(decisionId, 'rejected', updated.title, undefined, captainId);

    return updated;
  }

  getById(id: string): Decision | null {
    return this.store.get(id);
  }
}

export type { DecisionStore } from '@cabinet/types';
