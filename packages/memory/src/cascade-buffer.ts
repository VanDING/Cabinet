/**
 * Cascade Buffer — lightweight in-memory staging area before long-term memory.
 *
 * L0: raw short-term entries grouped by session/topic.
 * When a buffer seals, its contents are compressed into an L1 summary
 * and written to long-term memory. The original short-term entries are
 * then removed.
 *
 * For now this is memory-only; durability comes from the underlying
 * short-term SQLite store (entries survive until they are sealed).
 */

export interface CascadeEntry {
  id: string;
  content: string;
  sourceKey: string;
  sessionId: string;
  timestamp: Date;
}

export interface SealResult {
  sealed: CascadeEntry[];
  summaryContent: string;
}

export class CascadeBuffer {
  private buffers = new Map<string, CascadeEntry[]>(); // key: `${sessionId}:${topic}`

  /** Stage entries into the L0 buffer for a session/topic. */
  append(sessionId: string, topic: string, entries: CascadeEntry[]): void {
    const key = `${sessionId}:${topic}`;
    const existing = this.buffers.get(key) ?? [];
    existing.push(...entries);
    this.buffers.set(key, existing);
  }

  /** Get the current L0 buffer for a session/topic. */
  getBuffer(sessionId: string, topic: string): CascadeEntry[] {
    return this.buffers.get(`${sessionId}:${topic}`) ?? [];
  }

  /** Restore buffer entries from short-term storage after a restart. */
  restoreFromShortTerm(sessionId: string, topic: string, entries: CascadeEntry[]): void {
    const key = `${sessionId}:${topic}`;
    if (!this.buffers.has(key)) {
      this.buffers.set(key, entries);
    }
  }

  /** Check whether the buffer should be sealed. */
  shouldSeal(
    sessionId: string,
    topic: string,
    opts: { minCount?: number; maxAgeMs?: number } = {},
  ): boolean {
    const { minCount = 5, maxAgeMs = 30 * 60 * 1000 } = opts;
    const entries = this.getBuffer(sessionId, topic);
    if (entries.length < minCount) return false;
    const oldest = entries[0]?.timestamp.getTime() ?? Date.now();
    return Date.now() - oldest >= maxAgeMs;
  }

  /**
   * Seal a buffer: concatenate its entries into a plain-text summary
   * (LLM summarization can be injected via the caller) and remove the
   * buffer from memory.
   */
  seal(
    sessionId: string,
    topic: string,
    summarizer?: (entries: CascadeEntry[]) => string,
  ): SealResult {
    const key = `${sessionId}:${topic}`;
    const entries = this.buffers.get(key) ?? [];
    this.buffers.delete(key);

    if (entries.length === 0) {
      return { sealed: [], summaryContent: '' };
    }

    const summaryContent = summarizer ? summarizer(entries) : this.defaultSummarizer(entries);

    return { sealed: entries, summaryContent };
  }

  /** Force-seal all buffers belonging to a session (e.g. on session close). */
  sealAll(
    sessionId: string,
    summarizer?: (entries: CascadeEntry[]) => string,
  ): Map<string, SealResult> {
    const results = new Map<string, SealResult>();
    for (const [key, entries] of this.buffers) {
      if (!key.startsWith(`${sessionId}:`)) continue;
      this.buffers.delete(key);
      const topic = key.slice(sessionId.length + 1);
      const summaryContent = summarizer ? summarizer(entries) : this.defaultSummarizer(entries);
      results.set(topic, { sealed: entries, summaryContent });
    }
    return results;
  }

  /** Drop all buffers for a session without sealing. */
  clearSession(sessionId: string): void {
    for (const key of this.buffers.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        this.buffers.delete(key);
      }
    }
  }

  private defaultSummarizer(entries: CascadeEntry[]): string {
    const lines = entries.map((e) => `[${e.sourceKey}]: ${e.content}`);
    return `[Cascade Summary] ${entries.length} entries:\n${lines.join('\n')}`;
  }
}
