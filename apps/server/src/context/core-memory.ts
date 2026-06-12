import { ShortTermMemory, LongTermMemory, EntityMemory, ProjectMemory } from '@cabinet/memory';
import type { BuildState } from './build-state.js';

export function initCoreMemory(state: BuildState): void {
  const { db } = state;
  if (!db) {
    throw new Error('Database not initialized');
  }

  state.shortTerm = new ShortTermMemory(db, 1000);
  state.longTerm = new LongTermMemory(db);
  state.entity = new EntityMemory(db);
  state.project = new ProjectMemory(db);
}
