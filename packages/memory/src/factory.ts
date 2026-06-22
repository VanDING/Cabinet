/**
 * MemorySystem factory — single-call wiring of the full memory pipeline.
 *
 * Before this factory, consumers had to manually instantiate and connect:
 *   ShortTermMemory → CascadeBuffer → ConsolidationService → LongTermMemory → WriteGate
 *
 * Usage:
 *   const mem = createMemorySystem({ db, gateway });
 *   await mem.shortTerm.set('session-1', 'key', 'value');
 *   await mem.consolidation.consolidateSession('session-1');
 */

import Database from 'better-sqlite3';
import { ShortTermMemory } from './short-term.js';
import { LongTermMemory } from './long-term.js';
import { EntityMemory } from './entity.js';
import { ProjectMemory } from './project.js';
import { WriteGate } from './write-gate.js';
import { ConsolidationService } from './consolidation.js';
import { MemoryFacade } from './memory-facade.js';
import { MemoryDecayService } from './memory-decay.js';
import type { EmbeddingGateway } from './vector-utils.js';

export interface MemorySystemConfig {
  db: Database.Database;
  gateway?: EmbeddingGateway | null;
}

export interface MemorySystem {
  shortTerm: ShortTermMemory;
  longTerm: LongTermMemory;
  entity: EntityMemory;
  project: ProjectMemory;
  writeGate: WriteGate;
  consolidation: ConsolidationService;
  facade: MemoryFacade;
  decay: MemoryDecayService;
}

/**
 * Create a fully wired memory system with a single call.
 *
 * @example
 * ```ts
 * const mem = createMemorySystem({ db, gateway });
 * await mem.consolidation.consolidateSession(sessionId);
 * ```
 */
export function createMemorySystem(config: MemorySystemConfig): MemorySystem {
  const { db, gateway } = config;

  const shortTerm = new ShortTermMemory(db);
  const longTerm = new LongTermMemory(db);
  const entity = new EntityMemory(db);
  const project = new ProjectMemory(db);
  const writeGate = new WriteGate();
  const decay = new MemoryDecayService();

  const consolidation = new ConsolidationService(
    shortTerm,
    longTerm,
    gateway
      ? { embeddingProvider: { generateEmbeddings: gateway.generateEmbeddings.bind(gateway) } }
      : undefined,
  );

  const facade = new MemoryFacade({
    shortTerm,
    longTerm,
    entity,
    project,
    gateway,
  });

  return {
    shortTerm,
    longTerm,
    entity,
    project,
    writeGate,
    consolidation,
    facade,
    decay,
  };
}
