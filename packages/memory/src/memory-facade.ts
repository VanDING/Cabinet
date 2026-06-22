/**
 * MemoryFacade — unified interface for all memory operations.
 *
 * Replaces the fragmented access pattern where:
 * - Agent layer used MemoryProvider (5 methods, read-only oriented)
 * - Tool/Curator layer used direct底层实例 (shortTerm/longTerm/entity/project)
 *
 * The facade wraps the four underlying memory systems and provides a single
 * coherent API. Optional collaborators (sessionManager, gateway, consolidation)
 * extend the facade with higher-level behaviour without forcing new package
 * dependencies — we use structural types so callers can wire what they have.
 */

import type { ShortTermMemory } from './short-term.js';
import type { LongTermMemory, LongTermEntry } from './long-term.js';
import type { EntityMemory } from './entity.js';
import type { ProjectMemory, ProjectContext } from './project.js';
import type { ConsolidationService } from './consolidation.js';

/** Legacy MemoryProvider interface from @cabinet/agent — re-declared here to avoid circular dependency. */
export interface MemoryProvider {
  getShortTerm(sessionId: string): Promise<{ role: 'user' | 'assistant'; content: string }[]>;
  getProjectContext(projectId: string): Promise<string>;
  getEntityPreferences(captainId: string): Promise<Record<string, unknown>>;
  searchLongTerm(query: string, projectId: string): Promise<string[]>;
  getRecentInsights?(
    count: number,
  ): Promise<Array<{ text: string; relevance: number; source: string }>>;
}

/** Minimal session-manager shape for message merging. */
export interface SessionManagerLike {
  get(
    sessionId: string,
  ): { messages: { role: 'user' | 'assistant'; content: string }[] } | null | undefined;
}

import type { EmbeddingGateway } from './vector-utils.js';

/** @deprecated Use EmbeddingGateway from vector-utils. Kept for backward compat. */
export type EmbeddingGatewayLike = EmbeddingGateway;

export interface MemoryFacadeOptions {
  shortTerm: ShortTermMemory;
  longTerm: LongTermMemory;
  entity: EntityMemory;
  project: ProjectMemory;
  /** Optional — enables session-message merging in getSessionContext/getShortTerm. */
  sessionManager?: SessionManagerLike;
  /** Optional — enables on-demand embedding generation before semantic search. */
  gateway?: EmbeddingGatewayLike | null;
  /** Optional — enables consolidateSession() to flush cascade buffers and run LLM extraction. */
  consolidation?: ConsolidationService;
}

/**
 * MemoryFacade — unified interface for all memory operations.
 *
 * Implements MemoryProvider for backward compatibility with ContextBuilder,
 * while also exposing richer read/write methods for ToolExecutor and Curator.
 */
export class MemoryFacade implements MemoryProvider {
  constructor(private readonly deps: MemoryFacadeOptions) {}

  // ── MemoryProvider compatibility ──

  async getShortTerm(
    sessionId: string,
  ): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
    return this.getSessionContext(sessionId);
  }

  async getProjectContext(projectId: string): Promise<string> {
    return Promise.resolve(this.getProjectContextString(projectId));
  }

  async getEntityPreferences(captainId: string): Promise<Record<string, unknown>> {
    return this.getPreferences(captainId);
  }

  async searchLongTerm(query: string, _projectId: string): Promise<string[]> {
    const results = await this.search(query);
    return results.map((r) => `[Memory] ${r.content}`);
  }

  async getRecentInsights(
    count: number,
    types: string[] = ['insight', 'harness_insight', 'subconscious_insight'],
  ): Promise<Array<{ text: string; relevance: number; source: string }>> {
    const results = await this.deps.longTerm.search('', count * 3);
    return results
      .filter((r) => types.includes(String(r.metadata.type)))
      .slice(0, count)
      .map((r) => ({
        text: r.content,
        relevance: (r.metadata.relevance as number) ?? 0.5,
        source: (r.metadata.source as string) ?? 'unknown',
      }));
  }

  // ── Short-term (session-level) ──

  /**
   * Get conversation context for a session.
   *
   * Merges SessionManager conversation history (when a sessionManager collaborator
   * is wired) with short-term memory KV entries (e.g. session_brief, last_*).
   */
  async getSessionContext(
    sessionId: string,
  ): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
    const items: { role: 'user' | 'assistant'; content: string }[] = [];

    const session = this.deps.sessionManager?.get(sessionId);
    if (session && session.messages.length > 0) {
      const last = session.messages[session.messages.length - 1]!;
      const end = last.role === 'user' ? session.messages.length - 1 : session.messages.length;
      const start = Math.max(0, end - 20);

      if (end > 20) {
        const recentStart = end - 15;
        for (let i = recentStart; i < end; i++) {
          const m = session.messages[i]!;
          items.push({ role: m.role, content: m.content });
        }
        const olderParts: string[] = [];
        for (let i = start; i < recentStart; i++) {
          const m = session.messages[i]!;
          olderParts.push(m.content.slice(0, 100));
        }
        if (olderParts.length > 0) {
          items.unshift({
            role: 'user',
            content: '[Earlier context summary]: ' + olderParts.join(' | '),
          });
        }
      } else {
        for (let i = start; i < end; i++) {
          const m = session.messages[i]!;
          items.push({ role: m.role, content: m.content });
        }
      }
    }

    const kv = this.deps.shortTerm.getAll(sessionId);
    for (const [k, v] of Object.entries(kv)) {
      if (typeof v === 'string' && v.length > 0) {
        items.push({ role: 'user' as const, content: `[${k}]: ${v}` });
      }
    }

    return items;
  }

  /** Get conversation messages for a session (alias for getSessionContext). */
  async getSessionMessages(
    sessionId: string,
  ): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
    return this.getSessionContext(sessionId);
  }

  /** Store a key-value pair in short-term memory. */
  remember(sessionId: string, key: string, value: unknown, ttl?: number): void {
    this.deps.shortTerm.set(sessionId, key, value, ttl);
  }

  /** Retrieve a value from short-term memory, or all values if no key given. */
  recall(sessionId: string, key?: string): unknown | Record<string, unknown> {
    if (key) {
      return this.deps.shortTerm.get(sessionId, key);
    }
    return this.deps.shortTerm.getAll(sessionId);
  }

  /** Remove a short-term memory entry. */
  forget(sessionId: string, key: string): void {
    this.deps.shortTerm.delete(sessionId, key);
  }

  /** Clear all short-term state for a session. */
  clearSession(sessionId: string): void {
    this.deps.shortTerm.clear(sessionId);
  }

  // ── Long-term (semantic search + storage) ──

  /**
   * Search long-term memories by query (semantic + text fusion).
   * When a gateway collaborator is wired, embeddings are generated automatically.
   */
  async search(
    query: string,
    options?: { projectId?: string; limit?: number; embedding?: number[] },
  ): Promise<LongTermEntry[]> {
    const limit = options?.limit ?? 10;
    let embedding = options?.embedding;
    if (!embedding && this.deps.gateway && query.length > 0) {
      try {
        const er = await this.deps.gateway.generateEmbeddings({ texts: [query] });
        embedding = er.embeddings[0];
      } catch {
        /* fall back to text search */
      }
    }
    return this.deps.longTerm.search(query, limit, embedding);
  }

  /** Search memories and return content strings. */
  async searchMemories(
    query: string,
    options?: { projectId?: string; limit?: number; embedding?: number[] },
  ): Promise<LongTermEntry[]> {
    return this.search(query, options);
  }

  /** Store a new memory in long-term storage. */
  async storeMemory(
    content: string,
    metadata?: Record<string, unknown>,
    embedding?: number[],
  ): Promise<string> {
    return this.deps.longTerm.store({
      content,
      metadata: metadata ?? {},
      embedding,
      timestamp: new Date(),
    });
  }

  /** Update memory metadata (status, importance, etc.). */
  async updateMemory(
    id: string,
    updates: Partial<{ status: string; importance: number; confidence: number }>,
  ): Promise<boolean> {
    return this.deps.longTerm.updateMemory(id, updates);
  }

  /** Delete a long-term memory entry. */
  async deleteMemory(id: string): Promise<boolean> {
    return this.deps.longTerm.delete(id);
  }

  // ── Project ──

  /** Get structured project context. */
  getProject(projectId: string): ProjectContext | null {
    return this.deps.project.get(projectId);
  }

  /** Get project context as a string. */
  getProjectContextString(projectId: string): string {
    const ctx = this.deps.project.get(projectId);
    if (!ctx) return '';
    return [
      ctx.summary,
      ...(ctx.goals ?? []),
      ...(ctx.milestones ?? []).map(
        (m) =>
          `${(m as any).name ?? (m as any).title ?? 'milestone'} (${(m as any).status ?? 'open'})`,
      ),
      ...(ctx.keyDecisions ?? []).map(
        (d) => `${(d as any).title ?? 'decision'} (${(d as any).outcome ?? 'pending'})`,
      ),
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** Update the project's summary text. */
  updateProjectSummary(projectId: string, summary: string): void {
    this.deps.project.updateSummary(projectId, summary);
  }

  /** Add a decision record to a project. */
  addProjectDecision(projectId: string, title: string, description: string): void {
    this.deps.project.addDecision(projectId, title, description);
  }

  /** Add a milestone to a project. */
  addProjectMilestone(projectId: string, title: string): void {
    this.deps.project.addMilestone(projectId, title);
  }

  // ── Entity (preferences) ──

  /** Get preferences for an entity (Captain, Employee, etc.). */
  getPreferences(entityId: string): Record<string, unknown> {
    const prefs = this.deps.entity.getPreferences(entityId);
    return prefs?.preferences ?? {};
  }

  /** Set preferences for an entity. */
  setPreferences(entityId: string, preferences: Record<string, unknown>): void {
    const existing = this.deps.entity.getPreferences(entityId);
    this.deps.entity.setPreferences(entityId, (existing as any).name ?? entityId, {
      ...existing,
      ...preferences,
    });
  }

  // ── Consolidation ──

  /**
   * Consolidate a session's short-term knowledge into long-term storage.
   *
   * When a consolidation service is wired, this flushes cascade buffers and
   * optionally runs LLM-based extraction when a transcript + callback are
   * supplied. Without a consolidation service this is a no-op.
   */
  async consolidateSession(sessionId: string): Promise<void> {
    if (!this.deps.consolidation) return;
    await this.deps.consolidation.consolidateBasic(sessionId);
  }
}
