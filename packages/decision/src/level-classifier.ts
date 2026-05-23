import { DecisionLevel } from '@cabinet/types';

export interface ClassificationInput {
  scopeDescription: string;
  isCrossSession: boolean;
  optionCount: number;
  estimatedCostUsd: number;
  involvesFunds: boolean;
  involvesPermissions: boolean;
  involvesDataDeletion: boolean;
  involvesOrgConfig: boolean;
}

export class LevelClassifier {
  classify(input: ClassificationInput): string {
    const totalCost = Math.abs(input.estimatedCostUsd);

    // L3: funds, permissions, data deletion, org config, or high cost
    if (
      input.involvesFunds ||
      input.involvesPermissions ||
      input.involvesDataDeletion ||
      input.involvesOrgConfig ||
      totalCost > 1.0
    ) {
      return DecisionLevel.L3;
    }

    // L2: cross-session, many options, value trade-offs, or moderate cost
    if (input.isCrossSession || input.optionCount > 3 || totalCost > 0.1) {
      return DecisionLevel.L2;
    }

    // L1: within session, few options, low cost
    if (input.optionCount <= 3 && totalCost <= 0.1) {
      return DecisionLevel.L1;
    }

    // L0: no side effects, no cost, within single call
    if (!input.isCrossSession && input.optionCount <= 2 && totalCost === 0) {
      return DecisionLevel.L0;
    }

    // Default: escalate (safe side)
    return DecisionLevel.L2;
  }
}
