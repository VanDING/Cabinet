// ── Delegation Tiers (permission levels) ──

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

/** Maximum debate rounds per meeting */
export const MAX_DEBATE_ROUNDS = 3;

/** Maximum tokens per single speech */
export const MAX_TOKENS_PER_SPEECH = 4_096;

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

/** Meeting cost confirmation threshold in RMB — requires Captain confirmation above this */
export const MEETING_COST_CONFIRM_THRESHOLD = 0.5;

/** Rumination detection semantic similarity threshold — treated as duplicate argument above this */
export const RUMINATION_SIMILARITY_THRESHOLD = 0.85;

/** Decision expiry time in hours */
export const DECISION_EXPIRY_HOURS = 72;

/** Maximum number of advisors per meeting */
export const MAX_MEETING_ADVISORS = 5;

/** Maximum quality-gate retries */
export const MAX_QUALITY_RETRIES = 3;

/** Auto-backup interval in minutes */
export const BACKUP_INTERVAL_MINUTES = 360; // 6 hours

/** Number of backup copies to retain */
export const BACKUP_KEEP_COUNT = 7;

/** Budget period for cost tracking and alerts. */
export type BudgetPeriod = 'daily' | 'weekly' | 'monthly';
