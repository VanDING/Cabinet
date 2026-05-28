import type { LongTermMemory } from './long-term.js';

export interface DecayResult {
  expired: number;
  archived: number;
  superseded: number;
}

/**
 * Temporal memory decay service.
 *
 * Rules:
 * 1. validUntil < now → status = 'expired'
 * 2. confidence < 0.3 && accessCount < 3 && age > 30 days → status = 'archived'
 * 3. importance < 0.2 && age > 90 days → status = 'archived'
 *
 * Retrieval score = importance * confidence * recencyDecay(age) * accessBoost
 */
export class MemoryDecayService {
  constructor(private readonly longTerm: LongTermMemory) {}

  async runDecayCycle(): Promise<DecayResult> {
    const now = new Date();
    // Use explicit text search (LIKE '%%' matches all) instead of relying on
    // the empty-string FTS5 fallback path.
    const allRows = this.longTerm.searchByText('', 10_000);
    const results = allRows.map((r) => ({
      id: r.id,
      content: r.content,
      embedding: r.embedding ? (() => { try { return JSON.parse(r.embedding); } catch { return undefined; } })() : undefined,
      metadata: (() => { try { return JSON.parse(r.metadata ?? '{}') as Record<string, unknown>; } catch { return {} as Record<string, unknown>; } })(),
      timestamp: new Date(r.timestamp),
    }));
    let expired = 0;
    let archived = 0;
    let superseded = 0;

    for (const entry of results) {
      const meta = entry.metadata;
      const status = meta.status as string | undefined;
      if (status === 'expired' || status === 'archived') continue;

      const validUntil = meta.validUntil as string | undefined;
      if (validUntil && new Date(validUntil) < now) {
        meta.status = 'expired';
        expired++;
        this.longTerm._setMetadataSync(entry.id, meta);
        continue;
      }

      const ageDays = (now.getTime() - entry.timestamp.getTime()) / (1000 * 60 * 60 * 24);
      const confidence = (meta.confidence as number) ?? 0.5;
      const importance = (meta.importance as number) ?? 0.5;
      const accessCount = (meta.accessCount as number) ?? 0;

      if (confidence < 0.3 && accessCount < 3 && ageDays > 30) {
        meta.status = 'archived';
        archived++;
        this.longTerm._setMetadataSync(entry.id, meta);
        continue;
      }

      if (importance < 0.2 && ageDays > 90) {
        meta.status = 'archived';
        archived++;
        this.longTerm._setMetadataSync(entry.id, meta);
        continue;
      }

      if (status === 'superseded') {
        superseded++;
      }
    }

    return { expired, archived, superseded };
  }

  /** Compute a retrieval score for a memory entry. Higher = more relevant. */
  static score(entry: { timestamp: Date; metadata: Record<string, unknown> }): number {
    const importance = (entry.metadata.importance as number) ?? 0.5;
    const confidence = (entry.metadata.confidence as number) ?? 0.5;
    const accessCount = (entry.metadata.accessCount as number) ?? 0;
    const ageDays = (Date.now() - entry.timestamp.getTime()) / (1000 * 60 * 60 * 24);

    const recencyDecay = Math.exp(-ageDays / 30); // half-life 30 days
    const accessBoost = 1 + Math.log1p(accessCount);

    return importance * confidence * recencyDecay * accessBoost;
  }
}
