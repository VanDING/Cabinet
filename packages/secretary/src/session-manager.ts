import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';

const SESSIONS_DIR = join(homedir(), '.cabinet', 'sessions');

export interface Session {
  id: string;
  title: string;
  messages: { role: 'user' | 'assistant'; content: string; timestamp: Date }[];
  createdAt: Date;
  updatedAt: Date;
}

export class SessionManager {
  private sessions = new Map<string, Session>();

  constructor() {
    this.restoreSessions();
  }

  create(id: string, title?: string): Session {
    const session: Session = {
      id,
      title: title ?? `Session ${id}`,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.sessions.set(id, session);
    this.persist(session);
    return session;
  }

  get(id: string): Session | null {
    return this.sessions.get(id) ?? null;
  }

  addMessage(sessionId: string, role: 'user' | 'assistant', content: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messages.push({ role, content, timestamp: new Date() });
      session.updatedAt = new Date();
      this.persist(session);
    }
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.persist(session);
      this.sessions.delete(sessionId);
    }
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
    const path = this.sessionPath(sessionId);
    try { unlinkSync(path); } catch { /* ok */ }
  }

  list(): Session[] {
    return [...this.sessions.values()];
  }

  /** Persist a session to ~/.cabinet/sessions/<id>.json */
  private persist(session: Session): void {
    try {
      if (!existsSync(SESSIONS_DIR)) {
        mkdirSync(SESSIONS_DIR, { recursive: true });
      }
      writeFileSync(
        this.sessionPath(session.id),
        JSON.stringify(session, null, 2),
        'utf-8',
      );
    } catch { /* readonly filesystem — graceful degradation */ }
  }

  /** Restore active sessions from ~/.cabinet/sessions/ on startup */
  private restoreSessions(): void {
    try {
      if (!existsSync(SESSIONS_DIR)) return;
      const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'));
      for (const f of files) {
        try {
          const raw = readFileSync(join(SESSIONS_DIR, f), 'utf-8');
          const session = JSON.parse(raw) as Session;
          // Convert timestamp strings back to Date objects
          session.createdAt = new Date(session.createdAt);
          session.updatedAt = new Date(session.updatedAt);
          for (const msg of session.messages) {
            msg.timestamp = new Date(msg.timestamp);
          }
          this.sessions.set(session.id, session);
        } catch { /* skip corrupt session file */ }
      }
    } catch { /* sessions dir not available */ }
  }

  private sessionPath(id: string): string {
    return join(SESSIONS_DIR, `${id}.json`);
  }
}
