import { MessageType } from '@cabinet/types';
import { broadcast } from '../ws/handler.js';
import { KnowledgeGraph, MemoryDecayService } from '@cabinet/memory';
import { SubconsciousLoop } from '@cabinet/harness';
import type { BuildState } from './build-state.js';

export function initKnowledgeAndSubconscious(state: BuildState): void {
  const { db, longTerm, eventBus } = state;
  if (!db || !longTerm || !eventBus) {
    throw new Error('Missing required state for knowledge/subconscious');
  }

  const knowledgeGraph = new KnowledgeGraph(db);
  knowledgeGraph.ensureTables();

  const memoryDecay = new MemoryDecayService(longTerm);
  const subconsciousLoop = new SubconsciousLoop(longTerm, knowledgeGraph, eventBus);

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

  eventBus.subscribe(MessageType.SystemNotification, (msg) => {
    const payload = msg.payload as unknown as Record<string, unknown> | undefined;
    if (!payload) return;

    if (payload.type === 'subconscious_insight') {
      const insight = payload.insight as Record<string, unknown> | undefined;
      const relevance = (insight?.relevance as number) ?? 0;
      if (relevance > 0.5) {
        const text = (insight?.text as string) ?? '';
        const relatedEntities = (insight?.relatedEntities as string[]) ?? [];
        longTerm
          .store({
            content: text,
            metadata: {
              type: 'insight',
              relevance,
              relatedEntities,
              sourceMemoryId: insight?.sourceMemoryId ?? '',
            },
            timestamp: msg.timestamp,
          })
          .catch((err) => {
            console.warn('Operation failed', err);
          });
        broadcast('subconscious_insight', {
          text,
          relevance,
          relatedEntities,
          timestamp: msg.timestamp.toISOString(),
        });
      }
    }

    if (payload.type === 'process_identity_alert') {
      const data = payload.data as Record<string, unknown> | undefined;
      if (data) {
        broadcast('pis_alert', {
          sessionId: data.sessionId,
          score: data.score,
          trend: data.trend,
          action: data.action,
          timestamp: msg.timestamp.toISOString(),
        });
      }
    }

    if (payload.type === 'tool_variety') {
      const data = payload.data as Record<string, unknown> | undefined;
      if (data) {
        broadcast('tool_variety', {
          sessionId: data.sessionId,
          exposedTools: data.exposedTools,
          usedTools: data.usedTools,
          gapRatio: data.gapRatio,
          topTools: data.topTools,
          timestamp: msg.timestamp.toISOString(),
        });
      }
    }
  });

  state.knowledgeGraph = knowledgeGraph;
  state.memoryDecay = memoryDecay;
  state.subconsciousLoop = subconsciousLoop;
}
