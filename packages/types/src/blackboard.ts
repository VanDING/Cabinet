// ── Blackboard Topic Configuration ──

export type MergeStrategy = 'append' | 'replace' | 'merge';

export interface BlackboardTopic<T = unknown> {
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
