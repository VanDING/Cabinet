// ── Centralized Agent Configuration Types (Phase 4) ──

import type { MergeStrategy } from './blackboard.js';

// ── Step Events (4.0) ──

export interface StepEventsConfig {
  enabled: boolean;
  batchSize: number;
  flushIntervalMs: number;
  maxRetentionDays: number;
}

export const DEFAULT_STEP_EVENTS_CONFIG: StepEventsConfig = {
  enabled: false,
  batchSize: 10,
  flushIntervalMs: 5000,
  maxRetentionDays: 90,
};

// ── Adaptive Monitor (4.1) ──

export interface AdaptiveMonitorConfig {
  enabled: boolean;
  explorationRate: number;
  lookbackDays: number;
  minSamplesPerZone: number;
  hardLimits: {
    smartZoneMin: number;
    criticalThresholdMax: number;
  };
}

export const DEFAULT_ADAPTIVE_MONITOR_CONFIG: AdaptiveMonitorConfig = {
  enabled: false,
  explorationRate: 0.1,
  lookbackDays: 14,
  minSamplesPerZone: 20,
  hardLimits: {
    smartZoneMin: 0.3,
    criticalThresholdMax: 0.9,
  },
};

// ── Process Identity Score (4.3) ──

export interface PISConfig {
  enabled: boolean;
  mode: 'log_only' | 'intervene';
  evaluationIntervalSteps: number;
  weights?: {
    intentAlignment: number;
    toolCoherence: number;
    goalProgress: number;
    contextStability: number;
  };
}

export const DEFAULT_PIS_CONFIG: PISConfig = {
  enabled: false,
  mode: 'log_only',
  evaluationIntervalSteps: 3,
  weights: {
    intentAlignment: 0.35,
    toolCoherence: 0.25,
    goalProgress: 0.25,
    contextStability: 0.15,
  },
};

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
