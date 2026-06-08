import type { Decision, DelegationTier } from '@cabinet/types';

export interface MissionStatement {
  id: string;
  priority: number; // 1-10, higher = more important
  statement: string;
  implications: string[]; // concrete behavioral implications
}

export interface MissionProfile {
  /** Captain's risk tolerance: low = conservative, high = aggressive. Default: medium. */
  riskTolerance: 'low' | 'medium' | 'high';
  /** Captain's cost sensitivity: low = cost no object, high = frugal. Default: medium. */
  costSensitivity: 'low' | 'medium' | 'high';
  /** Preferred resolution strategy when S3 and S4 conflict. Default: balance. */
  conflictResolution: 's3_favors' | 's4_favors' | 'balance';
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
  private profile: MissionProfile;

  constructor(
    missions?: MissionStatement[],
    profile?: Partial<MissionProfile>,
  ) {
    this.missions = missions ?? PolicyEngine.defaultMissions();
    this.profile = {
      riskTolerance: 'medium',
      costSensitivity: 'medium',
      conflictResolution: 'balance',
      ...profile,
    };
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

  /** Update the mission profile from runtime preferences (e.g. EntityMemory). */
  setProfile(profile: Partial<MissionProfile>): void {
    this.profile = { ...this.profile, ...profile };
  }

  getProfile(): MissionProfile {
    return { ...this.profile };
  }

  /** Evaluate an adjustment action against policy. Returns the action (possibly modified) or null if blocked. */
  evaluateAdjustment(action: AdjustmentAction): AdjustmentAction | null {
    // Rule 0: Always allow critical notifications — they preserve autonomy
    if (action.type === 'notify_captain' && action.severity === 'critical') {
      return action;
    }

    // Rule 1 (user_autonomy): Block auto-approval of L3-equivalent actions
    if (this.isL3Equivalent(action)) {
      return null;
    }

    // Rule 2 (cost_transparency): Block non-urgent model swaps when budget critical
    if (action.type === 'model_swap' && this.isBudgetCritical(action)) {
      return null;
    }

    // Rule 3 (external_agent_sandbox): Block L2+ auto-adjustments from external agents
    if (this.isExternalAgentAction(action) && this.isElevatedAction(action)) {
      return null;
    }

    // Rule 4 (explainability): Require reasoning for applied significant actions
    if (action.applied && !this.hasReasoning(action) && this.isSignificant(action)) {
      return { ...action, applied: false };
    }

    return action;
  }

  /**
   * When S3 (control) and S4 (intelligence) conflict, arbitrate based on
   * mission priorities and the Captain's mission profile.
   *
   * The core tension is typically:
   * - S3 proposes cost-cutting / efficiency (cost_transparency mission)
   * - S4 proposes deeper analysis / quality (quality_first mission)
   *
   * Scoring focuses on these two key missions, with explainability as a tie-breaker.
   */
  arbitrate(
    s3Action: AdjustmentAction,
    s4Insight: { relevance: number; text: string },
  ): PolicyConflict {
    const costMission = this.missions.find((m) => m.id === 'cost_transparency');
    const qualityMission = this.missions.find((m) => m.id === 'quality_first');
    const explainMission = this.missions.find((m) => m.id === 'explainability');

    // S3 score: severity base + cost-cutting bonus
    let s3Score = 0;
    if (s3Action.severity === 'warning') s3Score += 2;
    if (s3Action.severity === 'critical') s3Score += 4;
    if (['model_swap', 'context_budget_reduce'].includes(s3Action.type)) {
      s3Score += (costMission?.priority ?? 0) * 0.5;
    }

    // S4 score: insight quality via quality_first mission
    let s4Score = (qualityMission?.priority ?? 0) * s4Insight.relevance;

    // Apply profile bias
    const bias =
      this.profile.conflictResolution === 's3_favors'
        ? 2
        : this.profile.conflictResolution === 's4_favors'
          ? -2
          : 0;
    const diff = s3Score - s4Score + bias;
    const threshold = 1.5;

    if (Math.abs(diff) < threshold) {
      return {
        s3Proposal: s3Action,
        s4Proposal: { type: 'insight', description: s4Insight.text, details: { relevance: s4Insight.relevance } },
        missionId: 'compromise',
        resolution: 'compromise',
        reason: `S3 score=${s3Score.toFixed(1)} vs S4 score=${s4Score.toFixed(1)} — within threshold; merging both recommendations`,
      };
    }

    if (diff > threshold) {
      return {
        s3Proposal: s3Action,
        s4Proposal: { type: 'insight', description: s4Insight.text, details: { relevance: s4Insight.relevance } },
        missionId: 's3_control',
        resolution: 's3_wins',
        reason: `S3 score=${s3Score.toFixed(1)} outweighs S4 score=${s4Score.toFixed(1)} per mission priorities`,
      };
    }

    return {
      s3Proposal: s3Action,
      s4Proposal: { type: 'insight', description: s4Insight.text, details: { relevance: s4Insight.relevance } },
      missionId: 's4_intelligence',
      resolution: 's4_wins',
      reason: `S4 score=${s4Score.toFixed(1)} outweighs S3 score=${s3Score.toFixed(1)} per mission priorities`,
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

  // ── Private helpers ──

  private isL3Equivalent(action: AdjustmentAction): boolean {
    // Actions that affect system-wide configuration or data integrity
    const l3Types = new Set([
      'trigger_reconsolidation',
      'evaluator_frequency_increase',
    ]);
    return l3Types.has(action.type) && action.applied && !action.requiresCaptainApproval;
  }

  private isBudgetCritical(action: AdjustmentAction): boolean {
    const budgetUsage = (action.details.budgetUsage as number) ?? 0;
    return budgetUsage > 0.9 && action.severity !== 'critical';
  }

  private isExternalAgentAction(action: AdjustmentAction): boolean {
    return (action.details.agentType as string | undefined)?.startsWith('external_') ?? false;
  }

  private isElevatedAction(action: AdjustmentAction): boolean {
    const elevatedTypes = new Set(['model_swap', 'context_budget_reduce', 'temperature_adjust']);
    return elevatedTypes.has(action.type);
  }

  private hasReasoning(action: AdjustmentAction): boolean {
    return typeof action.details.reasoning === 'string' && action.details.reasoning.length > 0;
  }

  private isSignificant(action: AdjustmentAction): boolean {
    return action.severity === 'warning' || action.severity === 'critical';
  }

  /**
   * Score a proposal against all missions.
   *
   * Returns a weighted sum where each mission contributes based on:
   * - Its priority (1-10)
   * - Its relevance to the proposal type
   */
  private scoreProposal(
    proposal: AdjustmentAction,
    source: 's3' | 's4',
  ): number {
    let score = 0;
    for (const mission of this.missions) {
      const relevance = this.missionRelevance(mission, proposal, source);
      score += mission.priority * relevance;
    }
    return score;
  }

  private missionRelevance(
    mission: MissionStatement,
    proposal: AdjustmentAction,
    source: 's3' | 's4',
  ): number {
    switch (mission.id) {
      case 'user_autonomy':
        return proposal.type === 'notify_captain' ? 1.0 : proposal.requiresCaptainApproval ? 0.5 : 0.1;
      case 'cost_transparency':
        return ['model_swap', 'context_budget_reduce'].includes(proposal.type) ? 0.8 : 0.2;
      case 'quality_first':
        return source === 's4' && proposal.type === 'insight'
          ? (proposal.details.relevance as number) ?? 0.5
          : 0.3;
      case 'explainability':
        return proposal.severity === 'critical' ? 0.7 : 0.3;
      case 'external_agent_sandbox':
        return (proposal.details.agentType as string | undefined)?.startsWith('external_') ? 1.0 : 0.1;
      default:
        return 0.2;
    }
  }
}
