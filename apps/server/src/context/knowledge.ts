import { MessageType } from '@cabinet/types';
import { broadcast } from '../ws/handler.js';
import { KnowledgeGraph, MemoryDecayService } from '@cabinet/memory';
import type { BuildState } from './types.js';

export function initKnowledgeAndSubconscious(state: BuildState): void {
  const { db, longTerm, eventBus } = state;
  if (!db || !longTerm || !eventBus) {
    throw new Error('Missing required state for knowledge/subconscious');
  }

  const knowledgeGraph = new KnowledgeGraph(db);
  knowledgeGraph.ensureTables();

  const memoryDecay = new MemoryDecayService(longTerm);

  longTerm.setKnowledgeGraph(knowledgeGraph);
  longTerm.setContradictionHandler((contradiction) => {
    state.logger?.info('Contradiction detected', {
      oldMemoryId: contradiction.oldMemoryId,
      confidence: contradiction.confidence,
      newMemoryId: contradiction.newMemoryId,
    });
    eventBus
      .publish({
        messageId: `contradiction_${Date.now()}`,
        correlationId: contradiction.newMemoryId,
        causationId: null,
        timestamp: new Date(),
        messageType: MessageType.SystemNotification,
        payload: {
          type: 'memory_contradiction',
          oldMemoryId: contradiction.oldMemoryId,
          oldContent: contradiction.oldContent.slice(0, 200),
          confidence: contradiction.confidence,
          newMemoryId: contradiction.newMemoryId,
          message: `A new memory may contradict an existing one (${Math.round(contradiction.confidence * 100)}% confidence).`,
        } as any,
      })
      .catch((err) => {
        console.warn('Operation failed', err);
      });
  });

  state.knowledgeGraph = knowledgeGraph;
  state.memoryDecay = memoryDecay;
}
