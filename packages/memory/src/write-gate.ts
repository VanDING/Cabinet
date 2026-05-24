/**
 * Write Gate — inspired by total-recall's tiered memory architecture.
 *
 * Before any short-term entry is promoted to long-term memory, it must pass
 * at least one of the 5 write-gate checks. This prevents the memory system
 * from becoming "sludge" filled with transient noise.
 */

export type MemoryTier = 'daily' | 'register' | 'working';

export interface WriteGateResult {
  allowed: boolean;
  reason: string;
  tier: MemoryTier;
}

export class WriteGate {
  evaluate(content: string, metadata: Record<string, unknown>): WriteGateResult {
    const key = typeof metadata.key === 'string' ? metadata.key : '';

    // Structural fast-path: keys with semantic prefixes are always retained
    if (key.startsWith('decision_') || key.startsWith('preference_') || key.startsWith('milestone_')) {
      return { allowed: true, reason: 'structured_key', tier: 'register' };
    }

    // Tier 3 (working memory) — highest priority, always loaded
    if (this.isExplicitRemember(content)) {
      return { allowed: true, reason: 'explicit_remember', tier: 'working' };
    }

    // Tier 2 (register) — domain knowledge, loaded on-demand
    if (this.isBehaviorChanging(content)) {
      return { allowed: true, reason: 'behavior_changing', tier: 'register' };
    }
    if (this.isCommitment(content)) {
      return { allowed: true, reason: 'commitment', tier: 'register' };
    }
    if (this.isDecisionWithReasoning(content)) {
      return { allowed: true, reason: 'decision', tier: 'register' };
    }

    // Tier 1 (daily) — observations, may age out
    if (this.isStableFact(content)) {
      return { allowed: true, reason: 'stable_fact', tier: 'daily' };
    }

    // Fallback: long-form content without obvious noise signals
    if (content.length > 50) {
      return { allowed: true, reason: 'length_fallback', tier: 'daily' };
    }

    return { allowed: false, reason: 'transient_noise', tier: 'daily' };
  }

  /** 1. Did the user explicitly say "remember this"? */
  private isExplicitRemember(content: string): boolean {
    return /记住这个|请记住|remember this|记住:|recuerda esto/i.test(content);
  }

  /** 2. Will it change how the agent behaves next time? */
  private isBehaviorChanging(content: string): boolean {
    const patterns = [
      /(?:总是|永远|never|always|must|should not|不要)\s+.+/i,
      /(?:preference|prefer|偏好|喜好|习惯)\s*[:：]/i,
      /(?:style|风格|语气|tone)\s*[:：]/i,
      /(?:language|语言|lang)\s*[:：]/i,
    ];
    return patterns.some((p) => p.test(content));
  }

  /** 3. Is it a commitment someone is counting on? */
  private isCommitment(content: string): boolean {
    const hasDeadline = /\b(?:deadline|due|before|by)\s+\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/i.test(content);
    const hasDeliverable = /\b(?:deliverable|milestone|release|ship|launch|交付|里程碑|发布)\b/i.test(content);
    const hasFollowUp = /\b(?:follow up|跟进|后续|todo|TODO|待办)\b/i.test(content);
    return hasDeadline || hasDeliverable || hasFollowUp;
  }

  /** 4. Is it a decision worth remembering the reasoning for? */
  private isDecisionWithReasoning(content: string): boolean {
    const hasDecisionWord = /\b(?:decided?|决策|决定|approved?|rejected?|选择|否决|批准)\b/i.test(content);
    const hasReasoning = /\b(?:because|since|therefore|原因|因为|所以|因此| rationale)\b/i.test(content);
    return hasDecisionWord && (hasReasoning || content.length > 80);
  }

  /** 5. Is it a stable fact that will come up again? */
  private isStableFact(content: string): boolean {
    if (content.length < 20) return false;
    const hasDate = /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/.test(content);
    const hasNumber = /\b\d+\b/.test(content);
    const hasEntity = /\b(?:project|system|API|database|架构|组件|module|service)\b/i.test(content);
    return hasDate || hasNumber || hasEntity;
  }
}
