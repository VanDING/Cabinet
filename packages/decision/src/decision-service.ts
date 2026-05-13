import { DecisionStatus, type Decision, type DecisionLevel } from '@cabinet/types';
import { DecisionStateMachine } from './state-machine.js';
import { LevelClassifier, type ClassificationInput } from './level-classifier.js';
import { AuditLogger } from './audit-log.js';
import { EscalationService } from './escalation.js';

export interface CreateDecisionInput {
  id: string;
  projectId: string;
  type: string;
  title: string;
  description: string;
  options: { id: string; label: string; impact: string }[];
  classification: ClassificationInput;
  captainId?: string;
}

export class DecisionService {
  constructor(
    private readonly stateMachine: DecisionStateMachine,
    private readonly classifier: LevelClassifier,
    private readonly auditLog: AuditLogger,
    private readonly escalation: EscalationService,
    private readonly store: DecisionStore
  ) {}

  create(input: CreateDecisionInput): Decision {
    const level = this.classifier.classify(input.classification);
    const decision: Decision = {
      id: input.id,
      projectId: input.projectId,
      type: input.type as any,
      level: level as DecisionLevel,
      status: DecisionStatus.Pending,
      title: input.title,
      description: input.description,
      options: input.options,
      createdAt: new Date(),
    };

    this.store.save(decision);
    this.auditLog.log({
      entityType: 'decision', entityId: decision.id,
      action: 'created', actor: input.captainId ?? 'system',
      changes: { level, title: input.title },
    });

    // Auto-process L0/L1
    if (level === 'L0' || level === 'L1') {
      decision.status = DecisionStatus.Approved;
      decision.resolvedAt = new Date();
      this.store.save(decision);
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
      entityType: 'decision', entityId: decisionId,
      action: 'approved', actor: captainId,
      changes: { chosenOptionId, status: newStatus },
    });

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
      entityType: 'decision', entityId: decisionId,
      action: 'rejected', actor: captainId,
      changes: { status: newStatus },
    });

    return updated;
  }

  getById(id: string): Decision | null {
    return this.store.get(id);
  }
}

export interface DecisionStore {
  save(decision: Decision): void;
  get(id: string): Decision | null;
  listByProject(projectId: string): Decision[];
  listPending(projectId: string): Decision[];
}
