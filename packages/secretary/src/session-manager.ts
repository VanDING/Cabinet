import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';

const SESSIONS_DIR = join(homedir(), '.cabinet', 'sessions');

/** Soft limit: trigger background compression when exceeded. */
const MESSAGE_SOFT_LIMIT = 200;
/** Hard cap: messages beyond this are aggressively trimmed. */
const MESSAGE_HARD_LIMIT = 500;
/** Number of recent messages to always keep uncompressed. */
const KEEP_RECENT = 30;
/** Number of oldest messages to keep (prevents total context loss). */
const KEEP_OLDEST = 30;
/** Sessions inactive longer than this are archived on cleanup. */
const SESSION_MAX_AGE_DAYS = 30;

export interface Session {
  id: string;
  title: string;
  projectId?: string;
  messages: { role: 'user' | 'assistant'; content: string; timestamp: Date }[];
  createdAt: Date;
  updatedAt: Date;
}

export type SessionCallback = (session: Session) => Promise<void> | void;

export class SessionManager {
  private sessions = new Map<string, Session>();
  private onCloseCallbacks: SessionCallback[] = [];
  private onCreateCallbacks: SessionCallback[] = [];

  constructor() {
    this.restoreSessions();
  }

  onSessionClose(cb: SessionCallback): void {
    this.onCloseCallbacks.push(cb);
  }

  onSessionCreate(cb: SessionCallback): void {
    this.onCreateCallbacks.push(cb);
  }

  private onCompressionCallbacks: SessionCallback[] = [];

  onCompressionNeeded(cb: SessionCallback): void {
    this.onCompressionCallbacks.push(cb);
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
    // Fire create callbacks asynchronously (non-blocking)
    for (const cb of this.onCreateCallbacks) {
      Promise.resolve(cb(session)).catch(() => { /* best-effort */ });
    }
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

      // Trigger compression callback when soft limit exceeded
      if (session.messages.length > MESSAGE_SOFT_LIMIT && session.messages.length <= MESSAGE_HARD_LIMIT) {
        for (const cb of this.onCompressionCallbacks) {
          Promise.resolve(cb(session)).catch(() => { /* best-effort */ });
        }
      }

      // Hard cap: layered compression before aggressive truncation
      if (session.messages.length > MESSAGE_HARD_LIMIT) {
        // Layer 1 — Virtual-view: compress oversized tool results in the middle band
        for (let i = KEEP_OLDEST; i < session.messages.length - KEEP_RECENT; i++) {
          const msg = session.messages[i]!;
          if (msg.role === 'user' && msg.content.length > 800) {
            const compressed = this.compressToolResult(msg.content);
            if (compressed.length < msg.content.length) {
              session.messages[i] = { role: msg.role, content: compressed, timestamp: msg.timestamp };
            }
          }
        }

        // Layer 2 — If still over limit, aggressive truncation
        if (session.messages.length > MESSAGE_HARD_LIMIT) {
          const excess = session.messages.length - MESSAGE_HARD_LIMIT + (MESSAGE_SOFT_LIMIT - KEEP_RECENT - KEEP_OLDEST);
          const oldest = session.messages.slice(0, KEEP_OLDEST);
          const recent = session.messages.slice(-KEEP_RECENT);
          const compactMarker: typeof session.messages[0] = {
            role: 'assistant',
            content: `[context_compact] ${excess} intermediate messages compressed due to session length limit.`,
            timestamp: new Date(),
          };
          session.messages = [...oldest, compactMarker, ...recent];
        }
      }

      this.persist(session);
    }
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.persist(session);
      this.sessions.delete(sessionId);
      // Fire close callbacks asynchronously (non-blocking)
      for (const cb of this.onCloseCallbacks) {
        Promise.resolve(cb(session)).catch(() => { /* best-effort */ });
      }
    }
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
    const path = this.sessionPath(sessionId);
    try { unlinkSync(path); } catch { /* ok */ }
  }

  /** Replace middle messages with a compressed summary marker. */
  compactMessages(sessionId: string, summary: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const oldest = session.messages.slice(0, KEEP_OLDEST);
    const recent = session.messages.slice(-KEEP_RECENT);
    const compactMarker: typeof session.messages[0] = {
      role: 'assistant',
      content: `[context_compact] ${summary}`,
      timestamp: new Date(),
    };
    session.messages = [...oldest, compactMarker, ...recent];
    this.persist(session);
  }

  /** Archive sessions that have been inactive for more than SESSION_MAX_AGE_DAYS.
   *  Returns the number of sessions cleaned up. */
  cleanExpiredSessions(): number {
    const cutoff = Date.now() - SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    let cleaned = 0;
    for (const [id, session] of this.sessions) {
      if (session.updatedAt.getTime() < cutoff) {
        this.sessions.delete(id);
        cleaned++;
        // Keep disk file for archival but remove from memory
      }
    }
    return cleaned;
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
      const cutoff = Date.now() - SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
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
          // Skip sessions older than max age
          if (session.updatedAt.getTime() < cutoff) continue;
          this.sessions.set(session.id, session);
        } catch { /* skip corrupt session file */ }
      }
    } catch { /* sessions dir not available */ }
  }

  private sessionPath(id: string): string {
    return join(SESSIONS_DIR, `${id}.json`);
  }

  /** Compress an oversized tool-result message by truncating and adding reload hints. */
  private compressToolResult(content: string): string {
    if (!content.includes('Tool result')) return content;

    const toolMatch = content.match(/Tool result for (\w+):/);
    const toolName = toolMatch ? toolMatch[1] : 'tool';

    // For file reads, preserve the file path so the agent can reload
    if (toolName === 'read_file' || toolName === 'file_info') {
      const pathMatch = content.match(/(?:filePath|file path|path):?\s*([^\n\r]+)/i);
      const path = pathMatch?.[1]?.trim() ?? 'unknown';
      return `[Tool result: ${toolName} ${path}] Content truncated (${content.length} chars). Use ${toolName} to reload if needed.\n${content.slice(0, 150)}...`;
    }

    // General truncation with tool name preserved
    return `[Tool result: ${toolName}] Content truncated (${content.length} chars).\n${content.slice(0, 200)}...`;
  }
}
