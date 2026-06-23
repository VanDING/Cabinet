import type { ConsolidationService, KnowledgeGraph, MemoryDecayService } from '@cabinet/memory';
import type { ServerContext } from './types.js';

export interface BuildState extends Partial<ServerContext> {
  dataDir: string;
  dbPath: string;
  dbMode: 'file' | 'memory';
  consolidation?: ConsolidationService;
  knowledgeGraph?: KnowledgeGraph;
  memoryDecay?: MemoryDecayService;
  memoryMaintenanceTimer?: ReturnType<typeof setInterval>;
}
