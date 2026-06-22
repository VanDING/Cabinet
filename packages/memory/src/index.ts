// ── Factory ──
export { createMemorySystem, type MemorySystemConfig, type MemorySystem } from './factory.js';

// ── Entity Extractor ──
export { extractCandidateEntities } from './entity-extractor.js';

// ── Short-term memory ──
export { ShortTermMemory } from './short-term.js';
export type { ShortTermEntry } from './short-term.js';

// ── Long-term memory ──
export { LongTermMemory } from './long-term.js';
export type { LongTermEntry, SimilarityResult, LlmJudge, LlmJudgeResult } from './long-term.js';

// ── Entity memory ──
export { EntityMemory } from './entity.js';
export type { EntityPreferences, EmployeeConfig } from './entity.js';

// ── Project memory ──
export { ProjectMemory } from './project.js';
export type { ProjectContext } from './project.js';

// ── Write Gate ──
export { WriteGate } from './write-gate.js';
export type {
  MemoryTier,
  WriteGateResult,
  WriteGateChannel,
  EmbeddingProvider,
  WriteGateOptions,
} from './write-gate.js';

// ── Cascade Buffer ──
export { CascadeBuffer } from './cascade-buffer.js';
export type { CascadeEntry, SealResult } from './cascade-buffer.js';

// ── Consolidation ──
export { ConsolidationService } from './consolidation.js';

// ── Knowledge Graph ──
export { KnowledgeGraph } from './knowledge-graph.js';
export type { Entity, Relation } from './knowledge-graph.js';

// ── Memory Decay ──
export { MemoryDecayService } from './memory-decay.js';

// ── Memory Facade ──
export { MemoryFacade } from './memory-facade.js';
export type {
  MemoryFacadeOptions,
  MemoryProvider,
  SessionManagerLike,
  EmbeddingGatewayLike,
} from './memory-facade.js';

// ── Project isolation ──
export { ProjectIsolatedMemory } from './project-isolation.js';

// ── Cross-project migration ──
export { CrossProjectMigrator } from './cross-project-migrator.js';
export type { MemoryScope, CrossProjectPattern } from './cross-project-migrator.js';

// ── RAG (P1-4) ──
export { chunkDocument, chunkDocuments } from './chunking.js';
export type { Chunk, ChunkingOptions } from './chunking.js';
export { BM25Index, HybridRetriever } from './hybrid-retriever.js';
export type { SimpleEmbedder } from './hybrid-retriever.js';
