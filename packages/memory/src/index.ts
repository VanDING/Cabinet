// ── Interfaces (type-only) ──
export type { MemoryOrchestrator, MemoryWriteOptions, MemoryQuery } from './orchestrator.js';

// ── Short-term memory ──
export { ShortTermMemory } from './short-term.js';
export type { ShortTermEntry } from './short-term.js';

// ── Long-term memory ──
export { LongTermMemory } from './long-term.js';
export type { LongTermEntry, SimilarityResult } from './long-term.js';

// ── Entity memory ──
export { EntityMemory } from './entity.js';
export type { EntityPreferences, EmployeeConfig } from './entity.js';

// ── Project memory ──
export { ProjectMemory } from './project.js';
export type { ProjectContext } from './project.js';

// ── Consolidation ──
export {
  ConsolidationService,
  type ConsolidationResult,
  type ConsolidationCallBack,
} from './consolidation.js';

// ── Project isolation ──
export { ProjectIsolatedMemory } from './project-isolation.js';
