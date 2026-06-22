// ── Delegation Tiers (permission levels) ──

/** Trust level used for MCP tool execution gating (T0-T3). */
export type TrustLevel = 'T0' | 'T1' | 'T2' | 'T3';

export const DelegationTier = {
  /** T0: Every write operation and decision requires Captain confirmation. */
  CaptainReview: 'T0',
  /** T1: Low-risk auto, high-risk confirm. Default for new setups. */
  StrategicGuard: 'T1',
  /** T2: Most operations auto, only L3 decisions and destructive ops confirm. */
  TrustedMode: 'T2',
  /** T3: Everything auto. Budget cap is the only gate. */
  FullAutonomy: 'T3',
} as const;

export type DelegationTier = (typeof DelegationTier)[keyof typeof DelegationTier];

/** Default captain ID used when none is provided. */
export const DEFAULT_CAPTAIN_ID = 'captain-1';

/** Default captain display name. */
export const DEFAULT_CAPTAIN_NAME = 'Captain';

/** Default delegation tier for new setups */
export const DEFAULT_DELEGATION_TIER: DelegationTier = DelegationTier.StrategicGuard;

/** Maximum retry count for transient errors (network timeout, 429 rate-limit) */
export const MAX_RETRY_TRANSIENT = 3;

/** Maximum retry count for recoverable errors (tool execution failure) */
export const MAX_RETRY_RECOVERABLE = 2;

/** LLM call timeout in milliseconds */
export const LLM_TIMEOUT_MS = 30_000;

/** Daily budget cap in RMB */
export const DAILY_BUDGET = 5.0;

/** Weekly budget cap in RMB */
export const WEEKLY_BUDGET = 25.0;

/** Monthly budget cap in RMB */
export const MONTHLY_BUDGET = 100.0;

/** Budget warning threshold — trigger reminder when this proportion is reached */
export const BUDGET_WARNING_THRESHOLD = 0.8;

/** Decision expiry time in hours */
export const DECISION_EXPIRY_HOURS = 72;

/** Auto-backup interval in minutes */
export const BACKUP_INTERVAL_MINUTES = 360; // 6 hours

/** Number of backup copies to retain */
export const BACKUP_KEEP_COUNT = 7;

/** Budget period for cost tracking and alerts. */
export type BudgetPeriod = 'daily' | 'weekly' | 'monthly';

// ── MCP Tool Risk Levels ──

/** Side-effect risk classification for MCP tools. */
export type MCPSideEffectRisk = 'none' | 'readonly' | 'mutation' | 'destructive';
