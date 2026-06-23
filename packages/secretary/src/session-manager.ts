import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
} from 'node:fs';

const SESSIONS_DIR = join(homedir(), '.cabinet', 'sessions');

export interface RoutingState {
  lastIntent: string;
  lastRoute: string;
  topicEmbedding: number[];
  routedAt: Date;
}

export interface Session {
  id: string;
  title: string;
  projectId?: string;
  messages: { role: 'user' | 'assistant'; content: string; timestamp: Date }[];
  routingState?: RoutingState;
  createdAt: Date;
  updatedAt: Date;
  parentId?: string;
  agentType?: string;
  status?: 'active' | 'waiting_for_user' | 'completed' | 'error';
  events?: unknown[];
  deliverable?: unknown;
  contextSlot?: import('@cabinet/types').ContextSlot;
}

export type SessionCallback = (session: Session) => Promise<void> | void;

export class SessionManager {
  private sessions = new Map<string, Session>();
  private onCloseCallbacks: SessionCallback[] = [];
  private onCreateCallbacks: SessionCallback[] = [];
  private onFirstUserMessageCallbacks: SessionCallback[] = [];
  private taskSessions = new Map<string, string>();
  private sessionTasks = new Map<string, string[]>();

  constructor() {
    this.restoreSessions();
  }

  onSessionClose(cb: SessionCallback): void {
    this.onCloseCallbacks.push(cb);
  }

  onSessionCreate(cb: SessionCallback): void {
    this.onCreateCallbacks.push(cb);
  }

  onFirstUserMessage(cb: SessionCallback): void {
    this.onFirstUserMessageCallbacks.push(cb);
  }

  create(id: string, title?: string, projectId?: string): Session {
    const session: Session = {
      id,
      title: title ?? `Session ${id}`,
      projectId,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.sessions.set(id, session);
    this.persist(session);
    for (const cb of this.onCreateCallbacks) {
      Promise.resolve(cb(session)).catch((err) => {
        console.warn('Operation failed', err);
      });
    }
    return session;
  }

  get(id: string): Session | null {
    return this.sessions.get(id) ?? null;
  }

  associateTask(taskId: string, sessionId: string): void {
    this.taskSessions.set(taskId, sessionId);
    const existing = this.sessionTasks.get(sessionId) ?? [];
    existing.push(taskId);
    this.sessionTasks.set(sessionId, existing);
  }

  getSessionByTaskId(taskId: string): Session | null {
    const sessionId = this.taskSessions.get(taskId);
    if (!sessionId) return null;
    return this.sessions.get(sessionId) ?? null;
  }

  setContextSlot(sessionId: string, slot: import('@cabinet/types').ContextSlot): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.contextSlot = { ...slot, version: (slot.version ?? 0) + 1 };
    }
  }

  getContextSlot(sessionId: string): import('@cabinet/types').ContextSlot | undefined {
    return this.sessions.get(sessionId)?.contextSlot;
  }

  addMessage(sessionId: string, role: 'user' | 'assistant', content: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      const isFirstUserMessage =
        role === 'user' && !session.messages.some((m) => m.role === 'user');
      session.messages.push({ role, content, timestamp: new Date() });
      session.updatedAt = new Date();
      if (isFirstUserMessage) {
        for (const cb of this.onFirstUserMessageCallbacks) {
          Promise.resolve(cb(session)).catch((err) => {
            console.warn('Operation failed', err);
          });
        }
      }
    }
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      const taskIds = this.sessionTasks.get(sessionId);
      if (taskIds) {
        for (const taskId of taskIds) this.taskSessions.delete(taskId);
        this.sessionTasks.delete(sessionId);
      }
      this.persist(session);
      this.sessions.delete(sessionId);
      for (const cb of this.onCloseCallbacks) {
        Promise.resolve(cb(session)).catch((err) => {
          console.warn('Operation failed', err);
        });
      }
    }
  }

  closeAndDelete(sessionId: string): void {
    this.close(sessionId);
    const path = this.sessionPath(sessionId);
    try {
      unlinkSync(path);
    } catch {
      /* ok */
    }
  }

  compactMessages(sessionId: string, summary: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.messages.length > 0) {
      const oldest = session.messages.slice(0, 1);
      const compact = {
        role: 'assistant' as const,
        content: `[context_compact] ${summary}`,
        timestamp: new Date(),
      };
      session.messages = [...oldest, compact];
      session.updatedAt = new Date();
    }
  }

  cleanExpiredSessions(): number {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let cleaned = 0;
    for (const [id, session] of this.sessions) {
      if (session.updatedAt.getTime() < cutoff) {
        this.sessions.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }

  list(): Session[] {
    return [...this.sessions.values()];
  }

  createChildSession(parentId: string, agentType: string, title?: string): Session {
    const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const session: Session = {
      id,
      title: title ?? `${agentType} Agent`,
      parentId,
      agentType,
      status: 'active',
      messages: [],
      events: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.sessions.set(id, session);
    return session;
  }

  getChildSessions(parentId: string): Session[] {
    return [...this.sessions.values()].filter((s) => s.parentId === parentId);
  }

  addEvent(sessionId: string, event: unknown): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.events = [...(session.events ?? []), event];
      session.updatedAt = new Date();
    }
  }

  updateStatus(sessionId: string, status: Session['status']): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
      session.updatedAt = new Date();
    }
  }

  setDeliverable(sessionId: string, deliverable: unknown): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.deliverable = deliverable;
      session.updatedAt = new Date();
    }
  }

  private persist(session: Session): void {
    try {
      if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });
    } catch {
      return;
    }
    try {
      writeFileSync(this.sessionPath(session.id), JSON.stringify(session, null, 2), 'utf-8');
    } catch {
      /* persist failure non-fatal */
    }
  }

  private restoreSessions(): void {
    try {
      if (!existsSync(SESSIONS_DIR)) return;
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      for (const f of readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'))) {
        try {
          const raw = readFileSync(join(SESSIONS_DIR, f), 'utf-8');
          const session = JSON.parse(raw) as Session;
          session.createdAt = new Date(session.createdAt);
          session.updatedAt = new Date(session.updatedAt);
          for (const msg of session.messages) msg.timestamp = new Date(msg.timestamp);
          if (session.updatedAt.getTime() < cutoff) continue;
          this.sessions.set(session.id, session);
        } catch {
          /* skip corrupt session */
        }
      }
    } catch {
      /* sessions dir not available */
    }
  }

  private sessionPath(id: string): string {
    return join(SESSIONS_DIR, `${id}.json`);
  }
}
