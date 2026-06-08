/**
 * Write Gate — inspired by total-recall's tiered memory architecture.
 *
 * Before any short-term entry is promoted to long-term memory, it must pass
 * at least one of the write-gate checks. This prevents the memory system
 * from becoming "sludge" filled with transient noise.
 *
 * Dual-channel architecture:
 * - Fast path: regex-based heuristic (always runs, < 1ms)
 * - Slow path: embedding semantic similarity (optional, runs when fast path misses)
 *
 * The slow path is reserved for future enhancement. Current implementation
 * uses the fast path exclusively, with hooks for async embedding evaluation.
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

export interface WriteGateOptions {
  /** Optional embedding provider for slow-path semantic classification. */
  embeddingProvider?: EmbeddingProvider;
  /** Pre-computed tier anchor embeddings for cosine similarity comparison. */
  anchorEmbeddings?: Record<string, number[]>;
  /** Whether to use the embedding slow path when fast path misses. Default: false. */
  useEmbeddingSlowPath?: boolean;
}

export class WriteGate {
  constructor(private readonly options: WriteGateOptions = {}) {}

  evaluate(content: string, metadata: Record<string, unknown>): WriteGateResult {
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
    const fast = this.evaluate(content, metadata);

    // Only run slow path if fast path missed and slow path is enabled
    if (fast.allowed || !this.options.useEmbeddingSlowPath || !this.options.embeddingProvider) {
      return fast;
    }

    try {
      const embedding = await this.options.embeddingProvider.generateEmbedding(content);
      const tier = this.classifyByEmbedding(embedding);
      if (tier) {
        return {
          allowed: true,
          reason: 'embedding_similarity',
          tier,
          channel: 'slow',
        };
      }
    } catch {
      // Embedding failure — gracefully fall back to fast path result
    }

    return { ...fast, channel: 'fallback' };
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

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return -1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
