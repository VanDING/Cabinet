import { ConsolidationService, MemoryFacade } from '@cabinet/memory';
import type { BuildState } from './build-state.js';

export function initMemoryFacade(state: BuildState): void {
  const { db, gateway, sessionManager, shortTerm, longTerm, entity, project } = state;
  if (!db || !sessionManager || !shortTerm || !longTerm || !entity || !project) {
    throw new Error('Missing required state for memory facade');
  }

  if (state.llmJudge) {
    longTerm.setLlmJudge(state.llmJudge);
  }

  const consolidation = new ConsolidationService(shortTerm, longTerm);
  const memoryFacade = new MemoryFacade({
    shortTerm,
    longTerm,
    entity,
    project,
    gateway,
    sessionManager,
    consolidation,
  });

  state.consolidation = consolidation;
  state.memoryFacade = memoryFacade;
}
