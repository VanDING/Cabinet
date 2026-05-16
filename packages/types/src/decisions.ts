// ── DecisionType ──

export const DecisionType = {
  Strategic: 'strategic',
  Action: 'action',
  Execution: 'execution',
  Anomaly: 'anomaly',
  Evolution: 'evolution',
} as const;

export type DecisionType = (typeof DecisionType)[keyof typeof DecisionType];

// ── DecisionLevel ──

export const DecisionLevel = {
  L0: 'L0',
  L1: 'L1',
  L2: 'L2',
  L3: 'L3',
} as const;

export type DecisionLevel = (typeof DecisionLevel)[keyof typeof DecisionLevel];

// ── DecisionStatus ──

export const DecisionStatus = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
  Expired: 'expired',
  Archived: 'archived',
} as const;

export type DecisionStatus = (typeof DecisionStatus)[keyof typeof DecisionStatus];

// ── State Machine ──

export const ALLOWED_TRANSITIONS: Record<DecisionStatus, DecisionStatus[]> = {
  [DecisionStatus.Pending]: [DecisionStatus.Approved, DecisionStatus.Rejected, DecisionStatus.Expired],
  [DecisionStatus.Approved]: [DecisionStatus.Archived],
  [DecisionStatus.Rejected]: [DecisionStatus.Archived],
  [DecisionStatus.Expired]: [DecisionStatus.Archived],
  [DecisionStatus.Archived]: [],
};

export const TERMINAL_STATUSES: DecisionStatus[] = [DecisionStatus.Archived];

export function isValidTransition(from: DecisionStatus, to: DecisionStatus): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

// ── Decision ──

export interface DecisionOption {
  id: string;
  label: string;
  impact: string;
}

export interface Decision {
  readonly id: string;
  projectId: string;
  type: DecisionType;
  level: DecisionLevel;
  status: DecisionStatus;
  title: string;
  description: string;
  options: DecisionOption[];
  chosenOptionId?: string;
  captainId?: string;
  createdAt: Date;
  resolvedAt?: Date;
}

/** Storage interface for decisions — implemented by @cabinet/storage. */
export interface DecisionStore {
  save(decision: Decision): void;
  get(id: string): Decision | null;
  listByProject(projectId: string): Decision[];
  listPending(projectId: string): Decision[];
}
