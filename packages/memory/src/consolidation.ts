import type { ShortTermMemory } from './short-term.js';
import type { LongTermMemory } from './long-term.js';

export class ConsolidationService {
  constructor(
    private readonly shortTerm: ShortTermMemory,
    private readonly longTerm: LongTermMemory
  ) {}

  async consolidate(sessionId: string): Promise<number> {
    const allEntries = this.shortTerm.getAll(sessionId);
    let migrated = 0;

    for (const [key, value] of Object.entries(allEntries)) {
      if (typeof value === 'string' && value.length > 50) {
        await this.longTerm.store({
          content: value,
          metadata: { key, sessionId, source: 'short_term' },
          timestamp: new Date(),
        });
        migrated++;
      }
    }

    // Clear short-term after migration
    this.shortTerm.clear(sessionId);
    return migrated;
  }
}
