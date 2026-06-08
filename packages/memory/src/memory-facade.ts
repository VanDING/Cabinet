/**
 * MemoryFacade — unified interface for all memory operations.
 *
 * Replaces the fragmented access pattern where:
 * - Agent layer used MemoryProvider (5 methods, read-only oriented)
 * - Tool/Curator layer used direct底层实例 (shortTerm/longTerm/entity/project)
 *
 * The facade wraps the four underlying memory systems and provides a single
 * coherent API. It does NOT add new behavior — it only unifies access.
 */

import type { ShortTermMemory } from './short-term.js';
import type { LongTermMemory, LongTermEntry } from './long-term.js';
import type { EntityMemory } from './entity.js';
import type { ProjectMemory } from './project.js';

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

export interface MemoryFacadeOptions {
  shortTerm: ShortTermMemory;
  longTerm: LongTermMemory;
  entity: EntityMemory;
  project: ProjectMemory;
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
    return this.getSessionMessages(sessionId);
  }

  async getProjectContext(projectId: string): Promise<string> {
    return Promise.resolve(this.getProjectContextString(projectId));
  }

  async getEntityPreferences(captainId: string): Promise<Record<string, unknown>> {
    return this.getPreferences(captainId);
  }

  async searchLongTerm(query: string, _projectId: string): Promise<string[]> {
    const results = await this.searchMemories(query, { limit: 10 });
    return results.map((r) => r.content);
  }

  // ── Short-term (session-level) ──

  /** Get conversation messages for a session. */
  async getSessionMessages(
    sessionId: string,
  ): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
    const all = this.deps.shortTerm.getAll(sessionId);
    // Filter to conversation-like entries (skip internal metadata keys)
    const messages: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const [key, value] of Object.entries(all)) {
      if (
        key.startsWith('msg_') ||
        key === 'last_user_message' ||
        key === 'last_assistant_message'
      ) {
        if (typeof value === 'string') {
          messages.push({ role: key.includes('assistant') ? 'assistant' : 'user', content: value });
        }
      }
    }
    return messages;
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

  // ── Long-term (semantic search + storage) ──

  /** Search long-term memories by query (semantic + text fusion). */
  async searchMemories(
    query: string,
    options?: { projectId?: string; limit?: number; embedding?: number[] },
  ): Promise<LongTermEntry[]> {
    const limit = options?.limit ?? 10;
    return this.deps.longTerm.search(query, limit, options?.embedding);
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

  // ── Project ──

  /** Get project context as a string. */
  getProjectContextString(projectId: string): string {
    const ctx = this.deps.project.get(projectId);
    if (!ctx) return '';
    return [
      ctx.summary,
      ...(ctx.goals ?? []),
      ...(ctx.milestones ?? []).map((m) => `${m.title} (${m.status ?? 'open'})`),
      ...(ctx.keyDecisions ?? []).map((d) => `${d.title} (${d.outcome ?? 'pending'})`),
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
}
