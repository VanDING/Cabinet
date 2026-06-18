// ── Blackboard Topic Configuration ──

export type MergeStrategy = 'append' | 'replace' | 'merge';

export interface BlackboardTopic {
  name: string;
  mergeStrategy: MergeStrategy;
  /** Runtime schema validation is the consumer's responsibility. */
  schema?: unknown;
  ttlMs?: number;
  maxEntries?: number;
}

// ── Blackboard Entry ──

export interface BlackboardEntry<T = unknown> {
  id: string;
  topic: string;
  agentId: string;
  timestamp: Date;
  payload: T;
  causationId: string | null;
}

// ── Runtime schemas for built-in topics (type-only, no runtime validation library) ──

export interface DiscoveryPayload {
  type: string;
  summary: string;
  [key: string]: unknown;
}

export interface ProjectPayload {
  name: string;
  tech_stack?: string;
  goals: string[];
  constraints?: Record<string, unknown>;
}

export interface PreferencesPayload {
  riskTolerance?: 'low' | 'medium' | 'high';
  preferredDecisionStyle?: 'consensus' | 'directive' | 'analytical';
  [key: string]: unknown;
}

export interface SecurityPayload {
  level: string;
  tier?: string;
  maxRetries: number;
}
