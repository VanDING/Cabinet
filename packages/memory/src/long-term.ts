export interface LongTermEntry {
  id: string;
  content: string;
  embedding?: number[];
  metadata: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Long-term memory using in-memory storage with TF-IDF-like simple search.
 * (LanceDB integration can replace this implementation later without changing the interface.)
 */
export class LongTermMemory {
  private entries: LongTermEntry[] = [];

  async store(entry: Omit<LongTermEntry, 'id'>): Promise<string> {
    const id = `ltm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.entries.push({ ...entry, id });
    return id;
  }

  async search(query: string, limit = 5): Promise<LongTermEntry[]> {
    const tokens = query.toLowerCase().split(/\s+/);
    const scored = this.entries.map(entry => {
      const content = entry.content.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (content.includes(token)) score++;
      }
      // Bonus for metadata matches
      for (const [, v] of Object.entries(entry.metadata)) {
        if (typeof v === 'string' && v.toLowerCase().includes(query.toLowerCase())) {
          score += 2;
        }
      }
      return { entry, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.entry);
  }

  async delete(id: string): Promise<boolean> {
    const idx = this.entries.findIndex(e => e.id === id);
    if (idx < 0) return false;
    this.entries.splice(idx, 1);
    return true;
  }

  size(): number { return this.entries.length; }
}
