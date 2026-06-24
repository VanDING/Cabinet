import { memory } from './index.js';
import type { ContextSlot } from '@cabinet/types';

export interface SessionInfo {
  id: string;
  title: string;
  projectId?: string;
  parentId?: string;
  agentType?: string;
  status?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class SessionService {
  private taskSessions = new Map<string, string>();
  private sessionTasks = new Map<string, string[]>();
  private contextSlots = new Map<string, ContextSlot>();
  private childSessions = new Map<string, SessionInfo>();

  async create(id: string, title?: string, projectId?: string): Promise<void> {
    try {
      await memory.createThread({
        threadId: id,
        resourceId: projectId ?? 'default',
        title: title ?? `Session ${id.slice(0, 8)}`,
        metadata: { projectId: projectId ?? null, createdAt: new Date().toISOString() },
      });
    } catch {
      /* thread may already exist */
    }
  }

  async get(id: string): Promise<SessionInfo | null> {
    try {
      const thread = await memory.getThreadById({ threadId: id });
      if (!thread) return null;
      return {
        id: thread.id,
        title: thread.title ?? '',
        projectId: (thread.metadata as any)?.projectId ?? undefined,
        createdAt: new Date(thread.createdAt),
        updatedAt: new Date(thread.updatedAt),
        status: 'active',
      };
    } catch {
      return null;
    }
  }

  async list(): Promise<SessionInfo[]> {
    try {
      const result = await memory.listThreads({ perPage: 100 });
      const threads = Array.isArray(result)
        ? result
        : ((result as any)?.threads ?? (result as any)?.data ?? []);
      return threads.map((t: any) => ({
        id: t.id,
        title: t.title ?? '',
        projectId: (t.metadata as any)?.projectId ?? undefined,
        parentId: (t.metadata as any)?.parentId ?? undefined,
        createdAt: new Date(t.createdAt),
        updatedAt: new Date(t.updatedAt),
        status: 'active',
      }));
    } catch {
      return [];
    }
  }

  async close(id: string): Promise<void> {
    try {
      await memory.deleteThread(id);
    } catch {
      /* thread may not exist */
    }
    this.sessionTasks.delete(id);
  }

  async fork(sourceSessionId: string, newSessionId: string): Promise<void> {
    try {
      await (memory as any).cloneThread({
        sourceThreadId: sourceSessionId,
        targetThreadId: newSessionId,
      });
    } catch {
      const source = await this.get(sourceSessionId);
      await this.create(
        newSessionId,
        source ? `${source.title} (fork)` : 'Forked Session',
        source?.projectId,
      );
    }
  }

  associateTask(taskId: string, sessionId: string): void {
    this.taskSessions.set(taskId, sessionId);
    const existing = this.sessionTasks.get(sessionId) ?? [];
    existing.push(taskId);
    this.sessionTasks.set(sessionId, existing);
  }

  getSessionByTaskId(taskId: string): SessionInfo | null {
    const sessionId = this.taskSessions.get(taskId);
    if (!sessionId) return null;
    return this.childSessions.get(sessionId) ?? null;
  }

  setContextSlot(sessionId: string, slot: ContextSlot): void {
    this.contextSlots.set(sessionId, { ...slot, version: (slot.version ?? 0) + 1 });
  }

  getContextSlot(sessionId: string): ContextSlot | undefined {
    return this.contextSlots.get(sessionId);
  }

  cleanExpiredSessions(): number {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let cleaned = 0;
    for (const [id, session] of this.childSessions) {
      if (session.updatedAt.getTime() < cutoff) {
        this.childSessions.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }

  createChildSession(parentId: string, agentType: string, title?: string): { id: string } {
    const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const session: SessionInfo = {
      id,
      title: title ?? `${agentType} Agent`,
      parentId,
      agentType,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.childSessions.set(id, session);
    return { id };
  }

  getChildSessions(parentId: string): SessionInfo[] {
    return [...this.childSessions.values()].filter((s) => s.parentId === parentId);
  }

  updateStatus(sessionId: string, status: string): void {
    const session = this.childSessions.get(sessionId);
    if (session) {
      session.status = status;
      session.updatedAt = new Date();
    }
  }

  setDeliverable(sessionId: string, _deliverable: unknown): void {
    const session = this.childSessions.get(sessionId);
    if (session) {
      session.updatedAt = new Date();
    }
  }

  addEvent(sessionId: string, _event: unknown): void {
    const session = this.childSessions.get(sessionId);
    if (session) {
      session.updatedAt = new Date();
    }
  }
}
