import { DecisionStatus, isValidTransition } from '@cabinet/types';

export class DecisionStateMachine {
  getInitialStatus(): string { return DecisionStatus.Pending; }

  canTransition(from: string, to: string): boolean {
    return isValidTransition(from as any, to as any);
  }

  transition(currentStatus: string, action: 'approve' | 'reject' | 'expire' | 'archive'): string {
    const targetMap: Record<string, string> = {
      approve: DecisionStatus.Approved,
      reject: DecisionStatus.Rejected,
      expire: DecisionStatus.Expired,
      archive: DecisionStatus.Archived,
    };
    const target = targetMap[action];
    if (!target) throw new Error(`Unknown action: ${action}`);
    if (!this.canTransition(currentStatus, target)) {
      throw new Error(`Invalid transition: ${currentStatus} -> ${target}`);
    }
    return target;
  }

  isTerminal(status: string): boolean {
    return status === DecisionStatus.Archived;
  }
}
