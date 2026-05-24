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

      if (typeof value !== 'string') continue;

      const gate = this.writeGate.evaluate(value, { key, sessionId });
      if (!gate.allowed) continue;

      if (gate.tier === 'register' || gate.tier === 'working') {
        await this.longTerm.store({
          content: value,
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
        dailyEntries.push({ key, value });
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

    for (const topic of topics) {
      if (this.cascade.shouldSeal(sessionId, topic, { minCount: 3, maxAgeMs: 30 * 60 * 1000 })) {
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
    }
    return sealedCount;
  }
}
