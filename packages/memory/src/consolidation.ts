import type { ShortTermMemory } from './short-term.js';
import type { LongTermMemory } from './long-term.js';
import { WriteGate } from './write-gate.js';
import { CascadeBuffer } from './cascade-buffer.js';

/**
 * Result of an LLM-powered consolidation pass.
 */
export interface ConsolidationResult {
  sessionId: string;
  /** Generated session summary. */
  summary: string;
  /** Key topics extracted. */
  topics: string[];
  /** Important knowledge to persist (with importance 0–1). */
  memories: { content: string; importance: number }[];
  /** Decisions made or referenced in this session. */
  decisions: { title: string; outcome: string }[];
  /** Suggested follow-up actions. */
  suggestions: string[];
}

/**
 * Consolidation callback — provided by the server layer to invoke the Curator Agent.
 * Takes the full session transcript and returns a structured consolidation result.
 */
export type ConsolidationCallBack = (
  sessionId: string,
  transcript: string,
) => Promise<ConsolidationResult>;

export class ConsolidationService {
  /** Minimum age (ms) for a short-term entry before it can be consolidated. */
  preserveRecentMs = 5 * 60 * 1000;
  private writeGate = new WriteGate();
  private cascade = new CascadeBuffer();

  constructor(
    private readonly shortTerm: ShortTermMemory,
    private readonly longTerm: LongTermMemory,
  ) {}

  /**
   * Lightweight consolidation (no LLM).
   *
   * Flow:
   * 1. Evaluate each short-term entry through the Write Gate.
   * 2. register / working tier → directly into long-term memory.
   * 3. daily tier → staged in Cascade Buffer (L0), waiting for seal.
   * 4. transient noise → skipped.
   */
  async consolidateBasic(sessionId: string): Promise<number> {
    const cutoff = Date.now() - this.preserveRecentMs;
    const allEntries = this.shortTerm.getAll(sessionId);
    const store = this.shortTerm._store;
    let directMigrated = 0;
    const dailyKeys: string[] = [];
    const dailyEntries: { key: string; value: string }[] = [];

    for (const [key, value] of Object.entries(allEntries)) {
      const fullKey = `${sessionId}:${key}`;
      const entry = store.get(fullKey);
      // Skip entries that are still fresh (active within preserveRecentMs)
      if (entry && entry.timestamp.getTime() > cutoff) continue;

      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      if (!stringValue) continue;

      const gate = this.writeGate.evaluate(stringValue, { key, sessionId });
      if (!gate.allowed) continue;

      if (gate.tier === 'register' || gate.tier === 'working') {
        await this.longTerm.store({
          content: stringValue,
          metadata: {
            key,
            sessionId,
            source: 'consolidation_basic',
            tier: gate.tier,
            reason: gate.reason,
          },
          timestamp: new Date(),
        });
        directMigrated++;
        this.shortTerm.delete(sessionId, key);
      } else {
        // daily tier → stage in cascade buffer
        dailyKeys.push(key);
        dailyEntries.push({ key, value: stringValue });
      }
    }

    // Stage daily entries into cascade buffer (grouped by key as topic)
    for (const { key, value } of dailyEntries) {
      this.cascade.append(sessionId, key, [
        {
          id: `${sessionId}:${key}:${Date.now()}`,
          content: value,
          sourceKey: key,
          sessionId,
          timestamp: new Date(),
        },
      ]);
    }

    // Track cascade buffering state in short-term for restart survival
    if (dailyEntries.length > 0) {
      const CASCADE_META_KEY = '__cascade_meta__';
      const existing = this.shortTerm._store.get(`${sessionId}:${CASCADE_META_KEY}`)?.value as
        | Record<string, { firstAt: number; entryCount: number }>
        | undefined;
      const updated = { ...(existing ?? {}) };
      for (const { key } of dailyEntries) {
        if (!updated[key]) {
          updated[key] = { firstAt: Date.now(), entryCount: 1 };
        } else {
          updated[key]!.entryCount++;
        }
      }
      this.shortTerm.set(sessionId, CASCADE_META_KEY, updated);
    }

    // Try to auto-seal buffers that meet thresholds
    const sealResults = await this.autoSeal(sessionId);

    return directMigrated + sealResults;
  }

  /**
   * Flush all pending cascade buffers for a session.
   * Called on session close or before consolidateWithLLM.
   * Returns the number of buffers that were sealed.
   */
  async flushSession(sessionId: string): Promise<number> {
    const results = this.cascade.sealAll(sessionId);
    let sealedCount = 0;
    for (const [topic, result] of results) {
      if (result.summaryContent.length === 0) continue;
      await this.longTerm.store({
        content: result.summaryContent,
        metadata: {
          sessionId,
          source: 'cascade_l1',
          topic,
          entryCount: result.sealed.length,
        },
        timestamp: new Date(),
      });
      for (const entry of result.sealed) {
        this.shortTerm.delete(sessionId, entry.sourceKey);
      }
      sealedCount++;
    }
    return sealedCount;
  }

  /**
   * Semantic consolidation using the Curator Agent (via callback).
   * The LLM reads the session transcript and extracts structured knowledge.
   */
  async consolidateWithLLM(
    sessionId: string,
    transcript: string,
    curatorCallback: ConsolidationCallBack,
  ): Promise<ConsolidationResult> {
    // Flush any pending daily-tier buffers first
    await this.flushSession(sessionId);

    const result = await curatorCallback(sessionId, transcript);

    // Store extracted memories with importance scores
    for (const mem of result.memories) {
      await this.longTerm.store({
        content: mem.content,
        metadata: {
          sessionId,
          source: 'curator_consolidation',
          importance: mem.importance,
          topics: result.topics,
        },
        timestamp: new Date(),
      });
    }

    // Store the summary itself as a high-importance memory
    if (result.summary) {
      await this.longTerm.store({
        content: `[Session Summary] ${result.summary}`,
        metadata: {
          sessionId,
          source: 'curator_summary',
          importance: 1.0,
          topics: result.topics,
        },
        timestamp: new Date(),
      });
    }

    // Clean up short-term memory after consolidation
    this.shortTerm.clear(sessionId);
    return result;
  }

  private async autoSeal(sessionId: string): Promise<number> {
    let sealedCount = 0;
    // Discover topics for this session
    const topics = new Set<string>();
    for (const key of this.shortTerm._store.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        const topic = key.slice(sessionId.length + 1);
        topics.add(topic);
      }
    }

    // Load persisted cascade metadata (survives restarts)
    const CASCADE_META_KEY = '__cascade_meta__';
    const cascadeMeta = this.shortTerm._store.get(`${sessionId}:${CASCADE_META_KEY}`)?.value as
      | Record<string, { firstAt: number; entryCount: number }>
      | undefined;

    for (const topic of topics) {
      // Check in-memory buffer OR persisted metadata for seal eligibility
      let shouldSeal = this.cascade.shouldSeal(sessionId, topic, { minCount: 3, maxAgeMs: 30 * 60 * 1000 });
      if (!shouldSeal && cascadeMeta?.[topic]) {
        const meta = cascadeMeta[topic]!;
        if (meta.entryCount >= 3 && Date.now() - meta.firstAt >= 30 * 60 * 1000) {
          // Restore buffer from short-term entries after restart
          const entries: import('./cascade-buffer.js').CascadeEntry[] = [];
          for (const [k, entry] of this.shortTerm._store) {
            if (k.startsWith(`${sessionId}:`) && k.slice(sessionId.length + 1) === topic) {
              entries.push({
                id: `${sessionId}:${topic}:${entry.timestamp.getTime()}`,
                content: typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value),
                sourceKey: topic,
                sessionId,
                timestamp: entry.timestamp,
              });
            }
          }
          if (entries.length > 0) {
            this.cascade.restoreFromShortTerm(sessionId, topic, entries);
            shouldSeal = true;
          }
        }
      }

      if (!shouldSeal) continue;

      const result = this.cascade.seal(sessionId, topic);
      if (result.summaryContent.length === 0) continue;
      await this.longTerm.store({
        content: result.summaryContent,
        metadata: {
          sessionId,
          source: 'cascade_l1',
          topic,
          entryCount: result.sealed.length,
        },
        timestamp: new Date(),
      });
      for (const entry of result.sealed) {
        this.shortTerm.delete(sessionId, entry.sourceKey);
      }
      sealedCount++;
    }

    // Clean up cascade meta for sealed topics
    if (cascadeMeta) {
      for (const topic of Object.keys(cascadeMeta)) {
        if (topics.has(topic)) {
          delete cascadeMeta[topic];
        }
      }
      if (Object.keys(cascadeMeta).length > 0) {
        this.shortTerm.set(sessionId, CASCADE_META_KEY, cascadeMeta);
      } else {
        this.shortTerm.delete(sessionId, CASCADE_META_KEY);
      }
    }

    return sealedCount;
  }
}
