import type { EventBus } from '@cabinet/events';
import type { BlackboardTopic, BlackboardEntry, BlackboardConfig } from '@cabinet/types';
import { DEFAULT_BLACKBOARD_CONFIG } from '@cabinet/types';
import { BlackboardTopicRouter } from './blackboard-topic-router.js';

/**
 * Agent Blackboard — shared real-time data surface for multi-agent collaboration.
 *
 * Built on top of EventBus via BlackboardTopicRouter. Supports append/replace/crdt
 * merge strategies, TTL, capacity limits, and snapshot generation for system-prompt
 * injection.
 */
export class AgentBlackboard {
  private topics = new Map<string, BlackboardTopic<unknown>>();
  private entries = new Map<string, BlackboardEntry<unknown>[]>();
  private router: BlackboardTopicRouter;
  private config: BlackboardConfig;

  constructor(eventBus: EventBus, config?: Partial<BlackboardConfig>) {
    this.router = new BlackboardTopicRouter(eventBus);
    this.config = { ...DEFAULT_BLACKBOARD_CONFIG, ...config };

    // Register built-in topics
    for (const t of this.config.topics) {
      this.registerTopic({
        name: t.name,
        mergeStrategy: t.mergeStrategy,
        maxEntries: t.maxEntries ?? this.config.defaultMaxEntries,
        ttlMs: t.ttlMs ?? this.config.defaultTtlMs,
      });
    }
  }

  /** Register a topic at runtime. */
  registerTopic<T>(topic: BlackboardTopic<T>): void {
    this.topics.set(topic.name, topic as BlackboardTopic<unknown>);
    if (!this.entries.has(topic.name)) {
      this.entries.set(topic.name, []);
    }
  }

  /** Write an entry to a topic. */
  async write<T>(topicName: string, payload: T, agentId: string): Promise<BlackboardEntry<T>> {
    const topic = this.topics.get(topicName);
    if (!topic) throw new Error(`Unknown blackboard topic: ${topicName}`);

    const entry: BlackboardEntry<T> = {
      id: `${topicName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      topic: topicName,
      agentId,
      timestamp: new Date(),
      payload,
      causationId: null,
    };

    let list = this.entries.get(topicName) ?? [];

    switch (topic.mergeStrategy) {
      case 'append':
        list.push(entry as BlackboardEntry<unknown>);
        break;
      case 'replace':
        list = [entry as BlackboardEntry<unknown>];
        break;
      case 'merge':
        // Last-write-wins per key for object payloads
        list = this.mergeObject(list, entry as BlackboardEntry<unknown>);
        break;
    }

    // Enforce maxEntries
    const max = topic.maxEntries ?? this.config.defaultMaxEntries;
    if (list.length > max) {
      list = list.slice(-max);
    }

    // Enforce TTL
    if (topic.ttlMs) {
      const cutoff = Date.now() - topic.ttlMs;
      list = list.filter((e) => e.timestamp.getTime() > cutoff);
    }

    this.entries.set(topicName, list);

    // Broadcast
    await this.router.publishTopic(topicName, { entry: payload, agentId });

    return entry;
  }

  /** Read current entries for a topic. */
  read<T>(topicName: string): BlackboardEntry<T>[] {
    const list = this.entries.get(topicName) ?? [];
    return list as BlackboardEntry<T>[];
  }

  /** Subscribe to real-time updates for a topic. */
  subscribe<T>(topicName: string, handler: (entry: BlackboardEntry<T>) => void): () => void {
    return this.router.subscribeTopic(topicName, (envelope) => {
      const data = (envelope.payload as unknown as Record<string, unknown>)?.data as
        | Record<string, unknown>
        | undefined;
      if (!data) return;
      const payload = data.entry as T;
      const agentId = (data.agentId as string) ?? 'unknown';
      if (payload !== undefined) {
        handler({
          id: envelope.messageId,
          topic: topicName,
          agentId,
          timestamp: envelope.timestamp,
          payload,
          causationId: envelope.causationId,
        });
      }
    });
  }

  /** Generate a text snapshot of selected topics (for system prompt injection). */
  snapshot(topics?: string[]): string {
    const targetTopics = topics ?? Array.from(this.entries.keys());
    const parts: string[] = [];

    for (const name of targetTopics) {
      const list = this.entries.get(name);
      if (!list || list.length === 0) continue;
      parts.push(`## ${name}`);
      for (const entry of list) {
        const ts = entry.timestamp.toISOString();
        const payloadStr =
          typeof entry.payload === 'string'
            ? entry.payload
            : JSON.stringify(entry.payload);
        parts.push(`- [${ts} @${entry.agentId}] ${payloadStr.slice(0, 200)}`);
      }
    }

    return parts.join('\n');
  }

  private mergeObject(
    list: BlackboardEntry<unknown>[],
    entry: BlackboardEntry<unknown>,
  ): BlackboardEntry<unknown>[] {
    const payload = entry.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      // Fall back to append for non-object payloads
      list.push(entry);
      return list;
    }

    // Find latest CRDT entry for this topic (last one with object payload)
    const lastCrdt = [...list].reverse().find((e) => {
      const p = e.payload;
      return p && typeof p === 'object' && !Array.isArray(p);
    });

    if (lastCrdt) {
      const merged = { ...(lastCrdt.payload as Record<string, unknown>), ...payload };
      const mergedEntry: BlackboardEntry<unknown> = {
        ...entry,
        payload: merged,
      };
      list.push(mergedEntry);
    } else {
      list.push(entry);
    }
    return list;
  }
}
