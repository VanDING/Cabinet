import type { LongTermMemory, LongTermEntry } from './long-term.js';

export type MemoryScope = 'project' | 'global' | 'workspace';

export interface CrossProjectPattern {
  sourceProjectId: string;
  targetProjectId: string;
  similarity: number;
  memories: Array<{ id: string; content: string; projectId: string }>;
}

/**
 * Cross-project memory migration and pattern discovery.
 *
 * Enables memories to transcend project boundaries:
 * - markAsGlobal: elevate project-scoped memories to global scope
 * - migrateToProject: copy memories into a different project
 * - findGlobalMemories: query memories available across all projects
 * - findCrossProjectPatterns: heuristic detection of similar memories
 *   across different projects (basic Jaccard word overlap)
 */
export class CrossProjectMigrator {
  constructor(private readonly longTerm: LongTermMemory) {}

  /** Update scope for given memory IDs. Returns count updated. */
  async markAsGlobal(memoryIds: string[]): Promise<number> {
    const entries = this.longTerm.findByIds(memoryIds);
    let updated = 0;
    for (const entry of entries) {
      const meta = { ...entry.metadata, scope: 'global' as MemoryScope };
      this.longTerm._setMetadataSync(entry.id, meta);
      updated++;
    }
    return updated;
  }

  /** Update scope to workspace for given memory IDs. */
  async markAsWorkspace(memoryIds: string[]): Promise<number> {
    const entries = this.longTerm.findByIds(memoryIds);
    let updated = 0;
    for (const entry of entries) {
      const meta = { ...entry.metadata, scope: 'workspace' as MemoryScope };
      this.longTerm._setMetadataSync(entry.id, meta);
      updated++;
    }
    return updated;
  }

  /** Copy memories to a target project (originals remain untouched). */
  async migrateToProject(memoryIds: string[], targetProjectId: string): Promise<number> {
    const entries = this.longTerm.findByIds(memoryIds);
    let migrated = 0;
    for (const entry of entries) {
      await this.longTerm.store({
        content: entry.content,
        metadata: {
          ...entry.metadata,
          projectId: targetProjectId,
          scope: 'project' as MemoryScope,
          migratedFrom: entry.metadata.projectId ?? entry.id,
          migratedAt: new Date().toISOString(),
        },
        embedding: entry.embedding,
        timestamp: new Date(),
      });
      migrated++;
    }
    return migrated;
  }

  /** Search memories with global scope. */
  async findGlobalMemories(query?: string, limit = 20): Promise<LongTermEntry[]> {
    const globals = this.longTerm.findByMetadataFilter({ scope: 'global' }, limit * 2);
    if (!query) return globals.slice(0, limit);
    const q = query.toLowerCase();
    return globals.filter((m) => m.content.toLowerCase().includes(q)).slice(0, limit);
  }

  /**
   * Heuristic cross-project pattern detection.
   *
   * Loads active memories with projectIds, then computes Jaccard word
   * overlap between pairs from different projects. Returns clusters
   * above the similarity threshold.
   */
  async findCrossProjectPatterns(minSimilarity = 0.4): Promise<CrossProjectPattern[]> {
    // Fetch a representative sample of active memories with projectIds
    const rows = this.longTerm.searchByText('', 2000);
    const withProject = rows
      .map((r) => {
        const meta = JSON.parse(r.metadata ?? '{}') as Record<string, unknown>;
        return {
          id: r.id,
          content: r.content,
          projectId: (meta.projectId as string) || '',
          status: (meta.status as string) || '',
        };
      })
      .filter((m) => m.projectId && m.status !== 'expired' && m.status !== 'archived');

    const patterns: CrossProjectPattern[] = [];
    const seenPairs = new Set<string>();

    for (let i = 0; i < withProject.length; i++) {
      const a = withProject[i]!;
      for (let j = i + 1; j < withProject.length; j++) {
        const b = withProject[j]!;
        if (a.projectId === b.projectId) continue;

        const sim = this.jaccardSimilarity(a.content, b.content);
        if (sim >= minSimilarity) {
          const pairKey = [a.projectId, b.projectId].sort().join('::');
          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);

          patterns.push({
            sourceProjectId: a.projectId,
            targetProjectId: b.projectId,
            similarity: sim,
            memories: [
              { id: a.id, content: a.content.slice(0, 200), projectId: a.projectId },
              { id: b.id, content: b.content.slice(0, 200), projectId: b.projectId },
            ],
          });
        }
      }
    }

    return patterns.sort((a, b) => b.similarity - a.similarity).slice(0, 20);
  }

  private jaccardSimilarity(a: string, b: string): number {
    const wordsA = new Set(
      a
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 2),
    );
    const wordsB = new Set(
      b
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 2),
    );
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);
    return intersection.size / union.size;
  }
}
