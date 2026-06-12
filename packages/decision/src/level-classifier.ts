import { DecisionLevel } from '@cabinet/types';

export interface ClassificationInput {
  scopeDescription: string;
  isCrossSession: boolean;
  optionCount: number;
  estimatedCost: number;
  involvesFunds: boolean;
  involvesPermissions: boolean;
  involvesDataDeletion: boolean;
  involvesOrgConfig: boolean;
  /** External agent trust level (0.0-1.0). Higher trust → may downgrade one level. */
  agentTrustLevel?: number;
  /** Type of operation being classified. */
  operationType?: 'command_execution' | 'file_read' | 'file_write' | 'api_call';
  /** Whether the operation originates from an external agent. */
  fromExternalAgent?: boolean;
}

export class LevelClassifier {
  classify(input: ClassificationInput): string {
    const totalCost = Math.abs(input.estimatedCost);
    let level: string;

    // L3: funds, permissions, data deletion, org config, or high cost
    if (
      input.involvesFunds ||
      input.involvesPermissions ||
      input.involvesDataDeletion ||
      input.involvesOrgConfig ||
      totalCost > 1.0
    ) {
      level = DecisionLevel.L3;
    } else if (input.isCrossSession || input.optionCount > 3 || totalCost > 0.1) {
      // L2: cross-session, many options, value trade-offs, or moderate cost
      level = DecisionLevel.L2;
    } else if (!input.isCrossSession && input.optionCount <= 2 && totalCost === 0) {
      // L0: no side effects, no cost, within single call (must be checked before L1)
      level = DecisionLevel.L0;
    } else if (input.optionCount <= 3 && totalCost <= 0.1) {
      // L1: within session, few options, low cost
      level = DecisionLevel.L1;
    } else {
      // Default: escalate (safe side)
      level = DecisionLevel.L2;
    }

    // External agent sandbox: command_execution from external agents gets +1 level
    if (input.fromExternalAgent && input.operationType === 'command_execution') {
      const escalate: Record<string, string> = {
        L0: DecisionLevel.L1,
        L1: DecisionLevel.L2,
        L2: DecisionLevel.L3,
        L3: DecisionLevel.L3,
      };
      level = escalate[level] ?? level;
    }

    // High trust level may downgrade one level (but never below L0)
    if (
      input.agentTrustLevel !== undefined &&
      input.agentTrustLevel >= 0.8 &&
      level !== DecisionLevel.L0
    ) {
      const downgrade: Record<string, string> = {
        L3: DecisionLevel.L2,
        L2: DecisionLevel.L1,
        L1: DecisionLevel.L0,
        L0: DecisionLevel.L0,
      };
      level = downgrade[level] ?? level;
    }

    return level;
  }
}
