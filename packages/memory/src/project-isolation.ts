import type { ShortTermMemory } from './short-term';
import type { LongTermMemory } from './long-term';
import type { EntityMemory } from './entity';
import type { ProjectMemory } from './project';

/**
 * Project isolation layer: prefixes all keys with projectId to scope memory per project.
 */
export class ProjectIsolatedMemory {
  constructor(
    private readonly projectId: string,
    private readonly shortTerm: ShortTermMemory,
    private readonly longTerm: LongTermMemory,
    private readonly entity: EntityMemory,
    private readonly project: ProjectMemory,
  ) {}

  getProjectId(): string {
    return this.projectId;
  }

  // Short-term: prefix keys with projectId
  shortTermSet(sessionId: string, key: string, value: unknown): void {
    this.shortTerm.set(`${this.projectId}:${sessionId}`, key, value);
  }

  shortTermGet(sessionId: string, key: string): unknown | null {
    return this.shortTerm.get(`${this.projectId}:${sessionId}`, key);
  }

  shortTermGetAll(sessionId: string): Record<string, unknown> {
    return this.shortTerm.getAll(`${this.projectId}:${sessionId}`);
  }

  // Long-term: filter by project metadata
  async longTermSearch(query: string, limit = 5): Promise<any[]> {
    const results = await this.longTerm.search(query, limit);
    return results.filter((r) => r.metadata?.projectId === this.projectId);
  }

  async longTermStore(content: string, metadata: Record<string, unknown>, embedding?: number[]): Promise<string> {
    return this.longTerm.store({
      content,
      metadata: { ...metadata, projectId: this.projectId },
      embedding,
      timestamp: new Date(),
    });
  }

  // Entity: always scoped to captain (not project)
  getPreferences(captainId: string) {
    return this.entity.getPreferences(captainId);
  }

  // Project: direct access
  getProjectContext() {
    return this.project.get(this.projectId);
  }

  switchProject(newProjectId: string): ProjectIsolatedMemory {
    return new ProjectIsolatedMemory(
      newProjectId,
      this.shortTerm,
      this.longTerm,
      this.entity,
      this.project,
    );
  }
}
