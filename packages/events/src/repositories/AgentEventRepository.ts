import type { AgentEvent, AgentEventStore } from '../agent-event-bus.js';

// Minimal Database interface to avoid a direct better-sqlite3 dependency
interface Stmt {
  run(...args: unknown[]): { changes: number };
  all(...args: unknown[]): unknown[];
  get(...args: unknown[]): unknown;
}
interface DB {
  prepare(sql: string): Stmt;
}

/**
 * SQLite-backed store for sub-agent execution events and deliverables.
 * Implements the AgentEventStore interface consumed by AgentEventBus.
 */
export class AgentEventRepository implements AgentEventStore {
  constructor(private db: DB) {}

  appendEvent(sessionId: string, event: AgentEvent): void {
    this.db
      .prepare(
        'INSERT INTO agent_events (session_id, event_type, payload) VALUES (?, ?, ?)',
      )
      .run(sessionId, event.type, JSON.stringify(event));
  }

  getEvents(sessionId: string): AgentEvent[] {
    const rows = this.db
      .prepare(
        'SELECT payload FROM agent_events WHERE session_id = ? ORDER BY created_at ASC, id ASC',
      )
      .all(sessionId) as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as AgentEvent);
  }

  setDeliverable(sessionId: string, deliverable: unknown): void {
    const type = typeof deliverable === 'object' && deliverable !== null
      ? (deliverable as any).type ?? (deliverable as any).agentType ?? 'unknown'
      : 'unknown';
    this.db
      .prepare(
        'INSERT INTO sub_agent_deliverables (session_id, deliverable_type, deliverable_json) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET deliverable_type = excluded.deliverable_type, deliverable_json = excluded.deliverable_json',
      )
      .run(sessionId, type, JSON.stringify(deliverable));
  }

  getDeliverable(sessionId: string): unknown | undefined {
    const row = this.db
      .prepare(
        'SELECT deliverable_json FROM sub_agent_deliverables WHERE session_id = ?',
      )
      .get(sessionId) as { deliverable_json: string } | undefined;
    return row ? JSON.parse(row.deliverable_json) : undefined;
  }
}
