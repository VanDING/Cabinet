/**
 * Write Gate — inspired by total-recall's tiered memory architecture.
 *
 * Before any short-term entry is promoted to long-term memory, it must pass
 * at least one of the write-gate checks. This prevents the memory system
 * from becoming "sludge" filled with transient noise.
 *
 * ## Dual-channel architecture
 *
 * - **Fast path** (always active): regex-based heuristic covering 8 languages
 *   (zh/en/fr/es/de/ru/ja/ko), 5 tier levels, and structured key prefixes
 *   (decision_/preference_/milestone_). Latency < 1ms, zero API cost.
 *
 * - **Slow path** (opt-in): embedding semantic similarity via cosine distance
 *   against per-tier anchor embeddings. Activated only when all of:
 *   `useEmbeddingSlowPath: true` + `embeddingProvider` + `anchorEmbeddings`
 *   are configured.
 *
 * ## Why the slow path is off by default
 *
 * The fast path's multi-language regex + structured key coverage catches the
 * vast majority of valuable memories. The slow path would only fire for
 * `transient_noise` misses — content that didn't match any regex pattern.
 * Activating it means:
 *   1. Every `transient_noise` entry triggers an embedding API call (cost)
 *   2. Most such entries are correctly classified as noise
 *   3. The marginal recall improvement is small relative to the cost
 *
 * **When to activate**: If you observe valuable memories being incorrectly
 * classified as `transient_noise`, enable the slow path and provide tier
 * anchor embeddings. Monitor the `channel: 'slow'` result count to assess
 * whether the embedding path is adding value or just burning tokens.
 */

export type MemoryTier = 'daily' | 'register' | 'working';

export type WriteGateChannel = 'fast' | 'slow' | 'fallback';

export interface WriteGateResult {
  allowed: boolean;
  reason: string;
  tier: MemoryTier;
  /** Which detection channel produced this result. */
  channel: WriteGateChannel;
}

/**
 * Optional embedding provider for the slow-path semantic similarity check.
 * When provided, WriteGate can fall back to embedding-based tier classification
 * if the regex fast path does not match any pattern.
 */
export interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[]>;
}

export interface WriteGateStats {
  totalEvaluated: number;
  transientNoise: number;
  byTier: Record<MemoryTier | 'rejected', number>;
  byChannel: Record<WriteGateChannel, number>;
}

export interface WriteGateOptions {
  /** Optional embedding provider for slow-path semantic classification. */
  embeddingProvider?: EmbeddingProvider;
  /** Pre-computed tier anchor embeddings for cosine similarity comparison. */
  anchorEmbeddings?: Record<string, number[]>;
  /** Whether to use the embedding slow path when fast path misses. Default: false. */
  useEmbeddingSlowPath?: boolean;
}

export class WriteGate {
  private stats: WriteGateStats = {
    totalEvaluated: 0,
    transientNoise: 0,
    byTier: { daily: 0, register: 0, working: 0, rejected: 0 },
    byChannel: { fast: 0, slow: 0, fallback: 0 },
  };

  constructor(private readonly options: WriteGateOptions = {}) {}

  /** Get current evaluation statistics. */
  getStats(): WriteGateStats {
    return {
      ...this.stats,
      byTier: { ...this.stats.byTier },
      byChannel: { ...this.stats.byChannel },
    };
  }

  /** Reset statistics counters. */
  resetStats(): void {
    this.stats = {
      totalEvaluated: 0,
      transientNoise: 0,
      byTier: { daily: 0, register: 0, working: 0, rejected: 0 },
      byChannel: { fast: 0, slow: 0, fallback: 0 },
    };
  }

  evaluate(content: string, metadata: Record<string, unknown>): WriteGateResult {
    this.stats.totalEvaluated++;
    const result = this._evaluate(content, metadata);
    this.recordStats(result);
    return result;
  }

  /** Fast-path evaluation without updating statistics (for sampling/analysis). */
  evaluateFastPathOnly(content: string, metadata: Record<string, unknown>): WriteGateResult {
    return this._evaluate(content, metadata);
  }

  private _evaluate(content: string, metadata: Record<string, unknown>): WriteGateResult {
    const key = typeof metadata.key === 'string' ? metadata.key : '';

    // Structural fast-path: keys with semantic prefixes are always retained
    if (
      key.startsWith('decision_') ||
      key.startsWith('preference_') ||
      key.startsWith('milestone_')
    ) {
      return { allowed: true, reason: 'structured_key', tier: 'register', channel: 'fast' };
    }

    // Tier 3 (working memory) — highest priority, always loaded
    if (this.isExplicitRemember(content)) {
      return { allowed: true, reason: 'explicit_remember', tier: 'working', channel: 'fast' };
    }

    // Tier 2 (register) — domain knowledge, loaded on-demand
    if (this.isBehaviorChanging(content)) {
      return { allowed: true, reason: 'behavior_changing', tier: 'register', channel: 'fast' };
    }
    if (this.isCommitment(content)) {
      return { allowed: true, reason: 'commitment', tier: 'register', channel: 'fast' };
    }
    if (this.isDecision(content)) {
      return { allowed: true, reason: 'decision', tier: 'register', channel: 'fast' };
    }

    // Tier 1 (daily) — observations, may age out
    if (this.isStableFact(content)) {
      return { allowed: true, reason: 'stable_fact', tier: 'daily', channel: 'fast' };
    }

    // Fallback: long-form content without obvious noise signals
    if (content.length > 50) {
      return { allowed: true, reason: 'length_fallback', tier: 'daily', channel: 'fast' };
    }

    return { allowed: false, reason: 'transient_noise', tier: 'daily', channel: 'fast' };
  }

  private recordStats(result: WriteGateResult): void {
    this.stats.byChannel[result.channel]++;
    if (result.allowed) {
      this.stats.byTier[result.tier]++;
    } else {
      this.stats.byTier.rejected++;
      this.stats.transientNoise++;
    }
  }

  /**
   * Async evaluation with embedding slow path.
   *
   * When the fast path returns `transient_noise` and an embedding provider is
   * configured, this method computes the content embedding and compares it
   * against pre-defined tier anchor embeddings via cosine similarity.
   *
   * Returns the fast-path result if the slow path is disabled or unavailable.
   */
  async evaluateAsync(
    content: string,
    metadata: Record<string, unknown>,
  ): Promise<WriteGateResult> {
    const fast = this._evaluate(content, metadata);

    // Only run slow path if fast path missed and slow path is enabled
    if (fast.allowed || !this.options.useEmbeddingSlowPath || !this.options.embeddingProvider) {
      this.recordStats(fast);
      return fast;
    }

    try {
      const embedding = await this.options.embeddingProvider.generateEmbedding(content);
      const tier = this.classifyByEmbedding(embedding);
      if (tier) {
        const slowResult: WriteGateResult = {
          allowed: true,
          reason: 'embedding_similarity',
          tier,
          channel: 'slow',
        };
        this.recordStats(slowResult);
        return slowResult;
      }
    } catch {
      // Embedding failure — gracefully fall back to fast path result
    }

    const fallback: WriteGateResult = { ...fast, channel: 'fallback' };
    this.recordStats(fallback);
    return fallback;
  }

  /** 1. Did the user explicitly say "remember this"? */
  private isExplicitRemember(content: string): boolean {
    return /记住这个|请记住|remember this|记住:|recuerda esto|merk dir das|souviens-toi|запомни|これを覚えて/i.test(
      content,
    );
  }

  /** 2. Will it change how the agent behaves next time? */
  private isBehaviorChanging(content: string): boolean {
    const patterns = [
      /(?:总是|永远|never|always|must|should not|不要|常に|immer|toujours|siempre)\s+.+/i,
      /(?:preference|prefer|偏好|喜好|习惯|préférence|preferencia)\s*[:：]/i,
      /(?:style|风格|语气|tone|estilo|stil)\s*[:：]/i,
      /(?:language|语言|lang|idioma|sprache|言語)\s*[:：]/i,
    ];
    return patterns.some((p) => p.test(content));
  }

  /** 3. Is it a commitment someone is counting on? */
  private isCommitment(content: string): boolean {
    const hasDeadline =
      /\b(?:deadline|due|before|by|期限|期限|échéance|frist|期限|期限)\s+\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/i.test(
        content,
      );
    const hasDeliverable =
      /\b(?:deliverable|milestone|release|ship|launch|交付|里程碑|发布|livraison|meilenstein|entrega)\b/i.test(
        content,
      );
    const hasFollowUp =
      /\b(?:follow up|跟进|后续|todo|TODO|待办|suivi|seguimiento|nachverfolgung)\b/i.test(content);
    return hasDeadline || hasDeliverable || hasFollowUp;
  }

  /** 4. Is it a decision worth remembering? */
  private isDecision(content: string): boolean {
    const hasDecisionWord =
      /\b(?:decided?|决策|决定|approved?|rejected?|选择|否决|批准|decisión|entschieden|決定)\b/i.test(
        content,
      );
    // Relaxed: a decision word alone is enough if the content is substantive.
    // Previously required both decision word + reasoning, which missed factual
    // decisions (e.g. "We decided to use React." has no explicit reasoning).
    const hasReasoning =
      /\b(?:because|since|therefore|原因|因为|所以|因此|rationale|porque|denn|weil|car)\b/i.test(
        content,
      );
    return hasDecisionWord && (hasReasoning || content.length > 50);
  }

  /** 5. Is it a stable fact that will come up again? */
  private isStableFact(content: string): boolean {
    if (content.length < 20) return false;
    const hasDate = /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/.test(content);
    const hasNumber = /\b\d+\b/.test(content);
    const hasEntity =
      /\b(?:project|system|API|database|架构|组件|module|service|component|framework|library)\b/i.test(
        content,
      );
    return hasDate || hasNumber || hasEntity;
  }

  /** Classify content by comparing its embedding against tier anchor embeddings. */
  private classifyByEmbedding(embedding: number[]): MemoryTier | null {
    const anchors = this.options.anchorEmbeddings;
    if (!anchors || Object.keys(anchors).length === 0) return null;

    const SIMILARITY_THRESHOLD = 0.75;
    let bestTier: MemoryTier | null = null;
    let bestScore = -1;

    for (const [anchorName, anchorEmbedding] of Object.entries(anchors)) {
      const score = cosineSimilarity(embedding, anchorEmbedding);
      if (score > bestScore && score >= SIMILARITY_THRESHOLD) {
        bestScore = score;
        // Map anchor names to tiers
        if (anchorName.startsWith('working')) bestTier = 'working';
        else if (anchorName.startsWith('register')) bestTier = 'register';
        else if (anchorName.startsWith('daily')) bestTier = 'daily';
      }
    }

    return bestTier;
  }
}

import { cosineSimilarity } from './vector-utils.js';
