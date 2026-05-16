import { DelegationTier } from '@cabinet/types';

export type SafetyTier = 'cache' | 'auto' | 'whitelist' | 'ai_classifier' | 'delegation_block';

export interface SafetyCheck {
  tier: SafetyTier;
  allowed: boolean;
  /** Human-readable explanation for the user. */
  reason?: string;
  /** The delegation tier that blocked this. Only set when tier = 'delegation_block'. */
  blockedByTier?: DelegationTier;
}

// ── Tool categorization ──────────────────────────────────────

/** Pure read tools — always safe at any tier. */
const READ_ONLY_TOOLS = new Set([
  'query_decisions', 'get_decision', 'get_status',
  'get_recent_events', 'get_project_context', 'get_captain_preferences',
  'recall', 'search_memory',
  'list_workflows', 'list_agents',
]);

/** Light write tools — reversible, no cost, no destruction. */
const LIGHT_WRITE_TOOLS = new Set([
  'remember', 'write_memory',
  'add_milestone', 'update_project_summary',
  'set_captain_preferences',
  'publish_notification',
  'register_agent',
]);

/** Moderate tools — create/update records, no destruction, low cost. */
const MODERATE_TOOLS = new Set([
  'create_decision', 'create_workflow', 'update_workflow',
  'create_employee',
]);

/** Heavy tools — cost money (LLM calls). */
const COST_TOOLS = new Set([
  'run_workflow', 'start_meeting',
]);

/** Destructive tools — irreversible changes. */
const DESTRUCTIVE_TOOLS = new Set([
  'delete_workflow', 'delete_file', 'execute_command', 'modify_config',
  'approve_decision', 'reject_decision',
]);

// ── Tier definitions ─────────────────────────────────────────
// At each tier, which tool categories are blocked (require Captain confirmation)?

/** T0: Only pure reads are allowed. Everything else is blocked. */
const T0_BLOCKED = new Set([
  ...LIGHT_WRITE_TOOLS,
  ...MODERATE_TOOLS,
  ...COST_TOOLS,
  ...DESTRUCTIVE_TOOLS,
]);

/** T1: Light writes and moderate tools auto; cost and destructive blocked. */
const T1_BLOCKED = new Set([
  ...COST_TOOLS,
  ...DESTRUCTIVE_TOOLS,
]);

/** T2: Only destructive tools blocked. */
const T2_BLOCKED = new Set([
  ...DESTRUCTIVE_TOOLS,
]);

/** T3: Nothing blocked. */
const T3_BLOCKED: Set<string> = new Set();

const TIER_BLOCKLISTS: Record<DelegationTier, Set<string>> = {
  [DelegationTier.CaptainReview]: T0_BLOCKED,
  [DelegationTier.StrategicGuard]: T1_BLOCKED,
  [DelegationTier.TrustedMode]: T2_BLOCKED,
  [DelegationTier.FullAutonomy]: T3_BLOCKED,
};

const TIER_LABELS: Record<DelegationTier, string> = {
  [DelegationTier.CaptainReview]: 'T0 — Captain Review',
  [DelegationTier.StrategicGuard]: 'T1 — Strategic Guard',
  [DelegationTier.TrustedMode]: 'T2 — Trusted Mode',
  [DelegationTier.FullAutonomy]: 'T3 — Full Autonomy',
};

// ── SafetyChecker ────────────────────────────────────────────

export class SafetyChecker {
  private tier: DelegationTier;
  private readonly whitelist: Set<string>;

  constructor(tier: DelegationTier = DelegationTier.StrategicGuard) {
    this.tier = tier;
    this.whitelist = new Set(READ_ONLY_TOOLS);
  }

  /** Update the delegation tier at runtime. */
  setTier(tier: DelegationTier): void {
    this.tier = tier;
  }

  /** Get current tier. */
  getTier(): DelegationTier {
    return this.tier;
  }

  check(toolName: string, _args: Record<string, unknown>): SafetyCheck {
    // Pure reads are always safe regardless of tier
    if (READ_ONLY_TOOLS.has(toolName)) {
      return { tier: 'cache', allowed: true };
    }

    // Check if blocked by current delegation tier
    const blocked = TIER_BLOCKLISTS[this.tier];
    if (blocked.has(toolName)) {
      return {
        tier: 'delegation_block',
        allowed: false,
        blockedByTier: this.tier,
        reason: [
          `Tool '${toolName}' requires Captain confirmation at ${TIER_LABELS[this.tier]}.`,
          this.tier === DelegationTier.CaptainReview
            ? 'All write operations are blocked in Captain Review mode.'
            : this.tier === DelegationTier.StrategicGuard
            ? 'Cost-incurring and destructive operations require confirmation in Strategic Guard mode.'
            : this.tier === DelegationTier.TrustedMode
            ? 'Destructive operations require confirmation in Trusted Mode.'
            : '',
        ].filter(Boolean).join(' '),
      };
    }

    // Allowed at current tier
    return { tier: 'auto', allowed: true };
  }

  /** Quick check: would this tool be blocked at the current tier? */
  isBlocked(toolName: string): boolean {
    if (READ_ONLY_TOOLS.has(toolName)) return false;
    return TIER_BLOCKLISTS[this.tier].has(toolName);
  }

  /** Get all tools currently blocked at this tier (for UI display). */
  getBlockedTools(): string[] {
    return [...TIER_BLOCKLISTS[this.tier]];
  }

  /** Get a human-readable description of the current tier. */
  getTierDescription(): string {
    switch (this.tier) {
      case DelegationTier.CaptainReview:
        return 'Every write operation and decision requires your confirmation. Recommended for initial setup and audit periods.';
      case DelegationTier.StrategicGuard:
        return 'Low-risk operations are automatic. Cost-incurring actions (meetings, workflow runs) and destructive changes require confirmation.';
      case DelegationTier.TrustedMode:
        return 'Most operations are automatic. Only destructive changes (deletion, decision rejection) require confirmation.';
      case DelegationTier.FullAutonomy:
        return 'Full autonomy. The budget cap is the only gate. A daily summary will keep you informed.';
    }
  }
}
