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

// ── Write Gate ──
export { WriteGate } from './write-gate.js';
export type { MemoryTier, WriteGateResult } from './write-gate.js';

// ── Cascade Buffer ──
export { CascadeBuffer } from './cascade-buffer.js';
export type { CascadeEntry, SealResult } from './cascade-buffer.js';

// ── Consolidation ──
export {
  ConsolidationService,
  type ConsolidationResult,
  type ConsolidationCallBack,
} from './consolidation.js';

// ── Knowledge Graph ──
export { KnowledgeGraph } from './knowledge-graph.js';
export type { Entity, Relation } from './knowledge-graph.js';

// ── Memory Decay ──
export { MemoryDecayService } from './memory-decay.js';
export type { DecayResult } from './memory-decay.js';

// ── Project isolation ──
export { ProjectIsolatedMemory } from './project-isolation.js';
