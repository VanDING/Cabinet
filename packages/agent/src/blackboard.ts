import type { EventBus } from '@cabinet/events';
import type {
  BlackboardTopic,
  BlackboardEntry,
  BlackboardConfig,
  ContextSlot,
} from '@cabinet/types';
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
  private topicVersions = new Map<string, number>();
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
    if (!this.topicVersions.has(topic.name)) {
      this.topicVersions.set(topic.name, 0);
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

    // Per-topic version counter (maps to ContextSlot.version on export)
    const currentVersion = this.topicVersions.get(topicName) ?? 0;
    this.topicVersions.set(topicName, currentVersion + 1);

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

  /**
   * Import a ContextSlot persistence snapshot into the Blackboard runtime surface.
   *
   * ContextSlot = serialized persistent snapshot; Blackboard = live runtime data surface.
   * Array fields become append entries; object fields become replace/merge entries.
   */
  async importFromContextSlot(slot: ContextSlot, agentId = 'system'): Promise<void> {
    // Ensure all required topics exist (default config may not include 'security' or 'deliverable')
    const requiredTopics: Array<{ name: string; mergeStrategy: BlackboardTopic['mergeStrategy'] }> =
      [
        { name: 'project', mergeStrategy: 'replace' },
        { name: 'memories', mergeStrategy: 'append' },
        { name: 'preferences', mergeStrategy: 'merge' },
        { name: 'files', mergeStrategy: 'replace' },
        { name: 'discoveries', mergeStrategy: 'append' },
        { name: 'outputs', mergeStrategy: 'append' },
        { name: 'security', mergeStrategy: 'replace' },
        { name: 'deliverable', mergeStrategy: 'replace' },
      ];
    for (const t of requiredTopics) {
      if (!this.topics.has(t.name)) {
        this.registerTopic({
          name: t.name,
          mergeStrategy: t.mergeStrategy,
          maxEntries: this.config.defaultMaxEntries,
        });
      }
    }

    // Seed topic versions from the snapshot version
    const baseVersion = slot.version ?? 0;
    for (const name of this.topics.keys()) {
      this.topicVersions.set(name, baseVersion);
    }

    if (slot.project) {
      await this.write('project', slot.project, agentId);
    }
    this.seedEntries('memories', slot.memories ?? [], agentId);
    if (slot.preferences && Object.keys(slot.preferences).length > 0) {
      await this.write('preferences', slot.preferences, agentId);
    }
    this.seedEntries('files', slot.files ?? [], agentId);
    this.seedEntries('discoveries', slot.discoveries ?? [], agentId);
    this.seedEntries('outputs', slot.previous_outputs ?? [], agentId);
    if (slot.security) {
      await this.write('security', slot.security, agentId);
    }
    if (slot.deliverable !== undefined) {
      await this.write('deliverable', slot.deliverable, agentId);
    }
  }

  /**
   * Export the current Blackboard state to a ContextSlot persistence snapshot.
   *
   * ContextSlot.version is mapped from the maximum per-topic version counter.
   */
  exportToContextSlot(): ContextSlot {
    const readLatest = <T>(topicName: string): T | undefined => {
      const list = this.entries.get(topicName);
      if (!list || list.length === 0) return undefined;
      return list[list.length - 1]!.payload as T;
    };

    const readAll = <T>(topicName: string): T[] => {
      const list = this.entries.get(topicName) ?? [];
      return list.map((e) => e.payload as T);
    };

    const project = readLatest<ContextSlot['project']>('project');
    const preferences = readLatest<ContextSlot['preferences']>('preferences');
    const security = readLatest<ContextSlot['security']>('security');
    const deliverable = readLatest<unknown>('deliverable');

    let version = 0;
    for (const v of this.topicVersions.values()) {
      if (v > version) version = v;
    }

    return {
      version,
      project: project ?? { name: 'default', goals: [] },
      memories: readAll<string>('memories'),
      preferences: preferences ?? {},
      files: readAll<string>('files'),
      discoveries: readAll<ContextSlot['discoveries'][number]>('discoveries'),
      previous_outputs: readAll<string>('outputs'),
      security: security ?? { level: 'L1', maxRetries: 2 },
      ...(deliverable !== undefined ? { deliverable } : {}),
    };
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
          typeof entry.payload === 'string' ? entry.payload : JSON.stringify(entry.payload);
        parts.push(`- [${ts} @${entry.agentId}] ${payloadStr.slice(0, 200)}`);
      }
    }

    return parts.join('\n');
  }

  /** Directly append multiple entries to a topic (used for ContextSlot import). */
  private seedEntries<T>(topicName: string, payloads: T[], agentId: string): void {
    const topic = this.topics.get(topicName);
    if (!topic) throw new Error(`Unknown blackboard topic: ${topicName}`);
    const list = this.entries.get(topicName) ?? [];
    const now = new Date();
    for (const payload of payloads) {
      list.push({
        id: `${topicName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        topic: topicName,
        agentId,
        timestamp: now,
        payload,
        causationId: null,
      });
    }
    this.entries.set(topicName, list);
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
