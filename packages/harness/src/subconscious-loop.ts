import type { EventBus } from '@cabinet/events';
import { MessageType } from '@cabinet/types';
import type { LongTermMemory } from '@cabinet/memory';
import type { KnowledgeGraph } from '@cabinet/memory';

export interface SubconsciousInsight {
  relevance: number;
  text: string;
  sourceMemoryId: string;
  relatedEntities: string[];
}

/**
 * Subconscious Loop — bio-inspired random recall mechanism.
 *
 * Periodically samples long-term memory at random, weights by
 * importance × recency × randomness, and generates insights.
 * High-relevance insights are published as SystemNotifications.
 */
export class SubconsciousLoop {
  constructor(
    private readonly longTerm: LongTermMemory,
    private readonly knowledgeGraph: KnowledgeGraph,
    private readonly eventBus: EventBus,
  ) {}

  async tick(): Promise<void> {
    // 1. Random sample from long-term memory
    const candidates = await this.sampleRandomMemories(10);
    if (candidates.length === 0) return;

    // 2. Score = random() × importance × recencyBoost
    const scored = candidates
      .map((mem) => {
        const importance = (mem.metadata.importance as number) ?? 0.5;
        const ageDays = (Date.now() - mem.timestamp.getTime()) / (1000 * 60 * 60 * 24);
        const recencyBoost = Math.exp(-ageDays / 60); // half-life 60 days
        const score = Math.random() * importance * recencyBoost;
        return { mem, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    // 3. For each selected memory, expand via knowledge graph and generate insight
    for (const { mem } of scored) {
      const related = await this.findRelatedEntities(mem.content);
      const insight = this.generateInsight(mem.content, related);
      if (insight.relevance > 0.6) {
        await this.eventBus.publish({
          messageId: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          correlationId: `sub_${Date.now()}`,
          causationId: null,
          timestamp: new Date(),
          messageType: MessageType.SystemNotification,
          payload: { type: 'subconscious_insight', insight } as any,
        });
      }
    }
  }

  private async sampleRandomMemories(count: number): Promise<
    Array<{
      id: string;
      content: string;
      metadata: Record<string, unknown>;
      timestamp: Date;
    }>
  > {
    // SQLite RANDOM() is fast for small tables; limit to active memories
    // Since LongTermMemory doesn't expose raw SQL, we use search with an empty query
    // and rely on the repository to return recent entries, then shuffle.
    const all = await this.longTerm.search('', 1000);
    const active = all.filter((m) => {
      const status = m.metadata.status as string | undefined;
      return status !== 'expired' && status !== 'archived';
    });
    // Fisher-Yates shuffle
    for (let i = active.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = active[i]!;
      active[i] = active[j]!;
      active[j] = tmp;
    }
    return active.slice(0, count);
  }

  private async findRelatedEntities(content: string): Promise<string[]> {
    // Extract a likely entity name from the first sentence
    const firstSentence = content.split(/[.!?。！？]/)[0] ?? content;
    const entities = this.knowledgeGraph.searchEntities(firstSentence, 3);
    if (entities.length === 0) return [];
    const related = this.knowledgeGraph.findRelated(entities[0]!.name, 1);
    return related.map((e) => e.name);
  }

  private generateInsight(content: string, related: string[]): SubconsciousInsight {
    // Simple heuristic: if there are related entities and the memory contains
    // a question or open topic, boost relevance.
    let relevance = 0.5;
    if (related.length > 0) relevance += 0.1;
    if (/\?|如何|why|what|how/i.test(content)) relevance += 0.15;
    if (content.length > 200) relevance += 0.1;

    const text =
      related.length > 0
        ? `You previously noted: "${content.slice(0, 120)}..." This connects to ${related.join(', ')}.`
        : `A past memory may be relevant: "${content.slice(0, 120)}..."`;

    return {
      relevance: Math.min(relevance, 0.95),
      text,
      sourceMemoryId: '', // filled by caller
      relatedEntities: related,
    };
  }
}
