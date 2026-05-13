export interface Session {
  id: string;
  title: string;
  messages: { role: 'user' | 'assistant'; content: string; timestamp: Date }[];
  createdAt: Date;
  updatedAt: Date;
}

export class SessionManager {
  private sessions = new Map<string, Session>();

  create(id: string, title?: string): Session {
    const session: Session = {
      id,
      title: title ?? `Session ${id}`,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.sessions.set(id, session);
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
    }
  }

  list(): Session[] {
    return [...this.sessions.values()];
  }
}
