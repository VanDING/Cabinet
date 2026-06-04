import type { Decision, DelegationTier } from '@cabinet/types';

export interface MissionStatement {
  id: string;
  priority: number; // 1-10, higher = more important
  statement: string;
  implications: string[]; // concrete behavioral implications
}

export interface PolicyConflict {
  s3Proposal: { type: string; description: string; details: Record<string, unknown> };
  s4Proposal?: { type: string; description: string; details: Record<string, unknown> };
  missionId: string;
  resolution: 's3_wins' | 's4_wins' | 'compromise' | 'escalate';
  reason: string;
}

export interface AdjustmentAction {
  type: string;
  severity: 'info' | 'warning' | 'critical';
  description: string;
  details: Record<string, unknown>;
  requiresCaptainApproval: boolean;
  applied: boolean;
  timestamp: string;
}

/**
 * S5 PolicyEngine — mission-driven arbitration layer.
 *
 * In Stafford Beer's Viable System Model, S5 (Policy) upholds the fundamental
 * mission and values, arbitrating between the demands of S3 (control/audit)
 * and S4 (intelligence/adaptation). This engine encodes those missions as
 * explicit, evaluable constraints.
 */
export class PolicyEngine {
  private missions: MissionStatement[];

  constructor(missions?: MissionStatement[]) {
    this.missions = missions ?? PolicyEngine.defaultMissions();
  }

  static defaultMissions(): MissionStatement[] {
    return [
      {
        id: 'user_autonomy',
        priority: 10,
        statement: 'Preserve Captain autonomy over system decisions',
        implications: ['Never auto-approve L3 decisions', 'T0 adjustments require explicit approval'],
      },
      {
        id: 'cost_transparency',
        priority: 7,
        statement: 'Operate within transparent budget constraints',
        implications: ['Prefer model downgrade over budget overrun', 'Alert before expensive operations'],
      },
      {
        id: 'quality_first',
        priority: 8,
        statement: 'Quality of output takes precedence over speed',
        implications: [
          'When S3 suggests cost-cutting and S4 suggests deeper analysis, prefer analysis unless budget critical',
        ],
      },
      {
        id: 'explainability',
        priority: 6,
        statement: 'All significant actions must be explainable',
        implications: ['Auto-adjustments must publish reasoning', 'Decisions require audit trail'],
      },
      {
        id: 'external_agent_sandbox',
        priority: 9,
        statement: 'External agents operate in a restricted sandbox by default',
        implications: [
          'L2 operations from external agents require Captain approval',
          'Command execution from external agents is escalated one level',
          'External agent file writes outside the project directory require L3 approval',
        ],
      },
    ];
  }

  /** Evaluate an adjustment action against policy. Returns the action (possibly modified) or null if blocked. */
  evaluateAdjustment(action: AdjustmentAction): AdjustmentAction | null {
    // Block any auto-approval of L3-equivalent actions when user_autonomy is active
    if (action.type === 'notify_captain' && action.severity === 'critical') {
      // Always allow critical notifications — they preserve autonomy by informing the user
      return action;
    }
    return action;
  }

  /** When S3 (control) and S4 (intelligence) conflict, arbitrate based on mission priorities. */
  arbitrate(
    s3Action: AdjustmentAction,
    s4Insight: { relevance: number; text: string },
  ): PolicyConflict {
    const qualityMission = this.missions.find((m) => m.id === 'quality_first');
    if (qualityMission && s4Insight.relevance > 0.8 && s3Action.type === 'context_budget_reduce') {
      return {
        s3Proposal: s3Action,
        s4Proposal: { type: 'insight', description: s4Insight.text, details: { relevance: s4Insight.relevance } },
        missionId: qualityMission.id,
        resolution: 's4_wins',
        reason: 'High-relevance insight overrides cost reduction per quality_first mission',
      };
    }
    return {
      s3Proposal: s3Action,
      s4Proposal: { type: 'insight', description: s4Insight.text, details: { relevance: s4Insight.relevance } },
      missionId: 'default',
      resolution: 's3_wins',
      reason: 'No overriding mission priority; default to operational control',
    };
  }

  /** Check if a decision is consistent with policy. */
  checkDecision(decision: Decision): { allowed: boolean; reason?: string } {
    const autonomy = this.missions.find((m) => m.id === 'user_autonomy');
    if (autonomy && decision.level === 'L3' && decision.status === 'approved' && decision.captainId === 'system') {
      return { allowed: false, reason: 'L3 decisions cannot be auto-approved per user_autonomy mission' };
    }

    // External agent sandbox: L2 operations from external agents must be explicitly approved
    const sandbox = this.missions.find((m) => m.id === 'external_agent_sandbox');
    if (sandbox) {
      const source = (decision as any)._source as { agentType?: string } | undefined;
      const isExternal = source?.agentType?.startsWith('external_');
      if (isExternal && decision.level === 'L2' && decision.captainId === 'system') {
        return { allowed: false, reason: 'L2 operations from external agents require Captain approval per external_agent_sandbox mission' };
      }
    }

    return { allowed: true };
  }
}
