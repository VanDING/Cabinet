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

// ── Blackboard Config ──

export interface BlackboardConfig {
  enabled: boolean;
  snapshotBudgetTokens: number;
  defaultMaxEntries: number;
  defaultTtlMs?: number;
  topics: Array<{
    name: string;
    mergeStrategy: MergeStrategy;
    maxEntries?: number;
    ttlMs?: number;
  }>;
}

export const DEFAULT_BLACKBOARD_CONFIG: BlackboardConfig = {
  enabled: false,
  snapshotBudgetTokens: 2000,
  defaultMaxEntries: 100,
  topics: [
    { name: 'discoveries', mergeStrategy: 'append' },
    { name: 'memories', mergeStrategy: 'append' },
    { name: 'files', mergeStrategy: 'replace' },
    { name: 'outputs', mergeStrategy: 'append' },
    { name: 'project', mergeStrategy: 'replace' },
    { name: 'preferences', mergeStrategy: 'merge' },
    { name: 'security', mergeStrategy: 'replace' },
  ],
};
