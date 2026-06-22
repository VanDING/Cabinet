import { ObservabilityCollector } from '@cabinet/harness';
import { SkillExtractor } from '@cabinet/agent';
import type { BuildState } from './build-state.js';

export function initFeedbackLoop(state: BuildState): void {
  const { db, eventBus, gateway, shortTerm } = state;
  if (!db || !eventBus || !shortTerm) {
    throw new Error('Missing required state for feedback loop');
  }

  state.observability = new ObservabilityCollector(eventBus);
  state.skillExtractor = new SkillExtractor(gateway ?? null);
}
