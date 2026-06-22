import type { ShortTermMemory } from './short-term.js';
import type { LongTermMemory } from './long-term.js';
import { WriteGate, type EmbeddingProvider } from './write-gate.js';
import { CascadeBuffer, type SealResult } from './cascade-buffer.js';

export interface ConsolidationServiceOptions {
  embeddingProvider?: EmbeddingProvider;
}

export class ConsolidationService {
  /** Minimum age (ms) for a short-term entry before it can be consolidated. */
  preserveRecentMs = 5 * 60 * 1000;

  /**
   * WriteGate uses fast path only (regex heuristic, zero LLM cost).
   *
   * The embedding slow path is intentionally not activated because:
   * - The 5-tier regex covers 8 languages + structured key prefixes
   * - The slow path would fire on `transient_noise` misses, most of
   *   which are correctly classified as noise
   * - Embedding API calls for every noise entry would add cost with
   *   minimal recall improvement
   *
   * To activate the slow path, pass `{ embeddingProvider, anchorEmbeddings,
   * useEmbeddingSlowPath: true }` to the WriteGate constructor.
   */
  private writeGate = new WriteGate();
  private cascade = new CascadeBuffer();

  constructor(
    private readonly shortTerm: ShortTermMemory,
    private readonly longTerm: LongTermMemory,
    options?: ConsolidationServiceOptions,
  ) {
    if (options?.embeddingProvider) {
      this.writeGate = new WriteGate({
        embeddingProvider: options.embeddingProvider,
        useEmbeddingSlowPath: true,
      });
    }
  }

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
    const startTime = Date.now();
    const entries = this.shortTerm.getEntriesOlderThan(sessionId, this.preserveRecentMs);

    // Daily slow-path sampling (D.6): re-evaluate a random subset of
    // transient_noise entries via embedding to measure recall lift.
    await this.sampleSlowPath(sessionId, entries);
    let directMigrated = 0;
    const dailyKeys: string[] = [];
    const dailyEntries: { key: string; value: string }[] = [];

    const metrics = {
      sessionId,
      totalEvaluated: entries.length,
      working: 0,
      register: 0,
      daily: 0,
      noise: 0,
      directMigrated: 0,
      cascadeStaged: 0,
      durationMs: 0,
    };

    for (const entry of entries) {
      const key = entry.key;
      const value = entry.value;

      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      if (!stringValue) continue;

      const gate = this.writeGate.evaluate(stringValue, { key, sessionId });
      if (!gate.allowed) {
        metrics.noise++;
        continue;
      }

      // Track tier distribution
      if (gate.tier === 'working') metrics.working++;
      else if (gate.tier === 'register') metrics.register++;
      else metrics.daily++;

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
        metrics.directMigrated++;
        this.shortTerm.delete(sessionId, key);
      } else {
        // daily tier → stage in cascade buffer
        dailyKeys.push(key);
        dailyEntries.push({ key, value: stringValue });
        metrics.cascadeStaged++;
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
      const existing = this.shortTerm.get(sessionId, CASCADE_META_KEY) as
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

    metrics.durationMs = Date.now() - startTime;
    this.logMetrics(metrics);

    return directMigrated + sealResults;
  }

  /**
   * Sample up to 20 transient_noise entries and re-run them through the
   * embedding slow path. Results are logged and recorded in WriteGate stats
   * to support a cost/benefit analysis of activating the slow path by default.
   */
  async sampleSlowPath(
    sessionId: string,
    entries?: Array<{ key: string; value: unknown }>,
  ): Promise<{ sampled: number; rescued: number }> {
    const candidates =
      entries ?? this.shortTerm.getEntriesOlderThan(sessionId, this.preserveRecentMs);
    const noiseEntries: Array<{ key: string; value: string }> = [];

    for (const entry of candidates) {
      const stringValue =
        typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
      if (!stringValue) continue;
      const fast = this.writeGate.evaluateFastPathOnly(stringValue, { key: entry.key, sessionId });
      if (!fast.allowed) {
        noiseEntries.push({ key: entry.key, value: stringValue });
      }
    }

    // Fisher-Yates shuffle and take up to 20
    for (let i = noiseEntries.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = noiseEntries[i]!;
      noiseEntries[i] = noiseEntries[j]!;
      noiseEntries[j] = tmp;
    }
    const sample = noiseEntries.slice(0, 20);

    let rescued = 0;
    for (const { key, value } of sample) {
      const slow = await this.writeGate.evaluateAsync(value, { key, sessionId });
      if (slow.allowed && slow.channel === 'slow') {
        rescued++;
      }
    }

    if (sample.length > 0) {
      console.debug(
        `[SlowPathSample] session=${sessionId} sampled=${sample.length} rescued=${rescued} ` +
          `recallLift=${((rescued / sample.length) * 100).toFixed(1)}%`,
      );
    }

    return { sampled: sample.length, rescued };
  }

  /** Emit consolidation metrics for observability. */
  private logMetrics(metrics: {
    sessionId: string;
    totalEvaluated: number;
    working: number;
    register: number;
    daily: number;
    noise: number;
    directMigrated: number;
    cascadeStaged: number;
    durationMs: number;
  }): void {
    const {
      sessionId,
      totalEvaluated,
      working,
      register,
      daily,
      noise,
      directMigrated,
      cascadeStaged,
      durationMs,
    } = metrics;
    // Structured log for debugging and cost tracking
    console.debug(
      `[ConsolidationMetrics] session=${sessionId} ` +
        `evaluated=${totalEvaluated} working=${working} register=${register} daily=${daily} noise=${noise} ` +
        `migrated=${directMigrated} staged=${cascadeStaged} duration=${durationMs}ms`,
    );
  }

  /**
   * Flush all pending cascade buffers for a session.
   * Called on session close or before consolidateWithLLM.
   * Returns the number of buffers that were sealed.
   */
  async flushSession(sessionId: string): Promise<number> {
    let sealedCount = 0;
    for (const topic of this.cascade.getTopics(sessionId)) {
      const result = await this.cascade.seal(sessionId, topic);
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
   * Seal a topic buffer, optionally using the configured Curator summarizer.
   * When a Curator callback is provided it becomes the single source of truth
   * for L1 compression, unifying the Cascade and Curator consolidation paths.
   */
  private async sealTopic(sessionId: string, topic: string): Promise<SealResult> {
    return this.cascade.seal(sessionId, topic);
  }

  private async autoSeal(sessionId: string): Promise<number> {
    let sealedCount = 0;
    // Discover topics for this session
    const allEntries = this.shortTerm.getEntriesOlderThan(sessionId, 0);
    const topics = new Set<string>();
    for (const entry of allEntries) {
      if (!entry.key.startsWith('__')) {
        topics.add(entry.key);
      }
    }

    // Load persisted cascade metadata (survives restarts)
    const CASCADE_META_KEY = '__cascade_meta__';
    const cascadeMeta = this.shortTerm.get(sessionId, CASCADE_META_KEY) as
      | Record<string, { firstAt: number; entryCount: number }>
      | undefined;

    for (const topic of topics) {
      // Check in-memory buffer OR persisted metadata for seal eligibility
      let shouldSeal = this.cascade.shouldSeal(sessionId, topic, {
        minCount: 3,
        maxAgeMs: 30 * 60 * 1000,
      });
      if (!shouldSeal && cascadeMeta?.[topic]) {
        const meta = cascadeMeta[topic]!;
        if (meta.entryCount >= 3 && Date.now() - meta.firstAt >= 30 * 60 * 1000) {
          // Restore buffer from short-term entries after restart
          const entries: import('./cascade-buffer.js').CascadeEntry[] = [];
          for (const entry of allEntries) {
            if (entry.key === topic) {
              entries.push({
                id: `${sessionId}:${topic}:${entry.timestamp.getTime()}`,
                content:
                  typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value),
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

      const result = await this.sealTopic(sessionId, topic);
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
