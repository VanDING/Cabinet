import type { ShortTermMemory } from './short-term.js';
import type { LongTermMemory } from './long-term.js';

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
  constructor(
    private readonly shortTerm: ShortTermMemory,
    private readonly longTerm: LongTermMemory,
  ) {}

  /**
   * Lightweight consolidation (no LLM).
   * Only migrates short-term entries > 50 chars to long-term.
   */
  async consolidateBasic(sessionId: string): Promise<number> {
    const allEntries = this.shortTerm.getAll(sessionId);
    let migrated = 0;

    for (const [key, value] of Object.entries(allEntries)) {
      if (typeof value === 'string' && value.length > 50) {
        await this.longTerm.store({
          content: value,
          metadata: { key, sessionId, source: 'consolidation_basic' },
          timestamp: new Date(),
        });
        migrated++;
      }
    }

    this.shortTerm.clear(sessionId);
    return migrated;
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
}
