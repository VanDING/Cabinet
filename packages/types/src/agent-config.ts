// ── Centralized Agent Configuration Types (Phase 4) ──

import type { MergeStrategy } from './blackboard.js';

// ── Blackboard (4.2) ──

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
