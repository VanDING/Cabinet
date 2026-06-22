import type { ModelMapping, ProviderEntry } from '@cabinet/gateway';
import type { LlmJudge } from '@cabinet/memory';
import type { ConsolidationService } from '@cabinet/memory';
import type { ObservabilityCollector, SubconsciousLoop } from '@cabinet/harness';
import type { KnowledgeGraph, MemoryDecayService } from '@cabinet/memory';
import type { CuratorSubsystem, CuratorTimers } from './curator.js';
import type { createDaemonContext } from '../daemon-context.js';
import type { ServerContext } from './types.js';

export interface BuildState extends Partial<ServerContext> {
  dataDir: string;
  dbPath: string;
  dbMode: 'file' | 'memory';
  modelMapping: ModelMapping;
  providerConfigsFromSettings: Record<string, ProviderEntry>;
  llmJudge?: LlmJudge;
  consolidation?: ConsolidationService;
  observability?: ObservabilityCollector;
  curatorSubsystem?: CuratorSubsystem;
  curatorTimers?: CuratorTimers;
  daemonContext?: ReturnType<typeof createDaemonContext>;
  knowledgeGraph?: KnowledgeGraph;
  memoryDecay?: MemoryDecayService;
  subconsciousLoop?: SubconsciousLoop;
  memoryMaintenanceTimer?: ReturnType<typeof setInterval>;
  // Internal wiring callbacks
  triggerCuratorPreferenceUpdate?: (...args: any[]) => void;
  setCuratorDecisionUpdateTrigger?: (fn: any) => void;
  setModelMapping?: (m: ModelMapping) => void;
  setProviderConfigsFromSettings?: (p: Record<string, ProviderEntry>) => void;
}
