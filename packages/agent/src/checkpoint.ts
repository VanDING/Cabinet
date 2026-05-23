import Database from 'better-sqlite3';

export interface CheckpointState {
  sessionId: string;
  step: number;
  messages: { role: 'user' | 'assistant'; content: string }[];
  toolCallHistory: { name: string; args: Record<string, unknown>; result: unknown }[];
  metadata: Record<string, unknown>;
}

export class CheckpointManager {
  constructor(private readonly db: Database.Database) {
    // Table created by migration 009; this is a no-op fallback for environments
    // where migrations haven't been run yet.
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_checkpoints (
        session_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  save(state: CheckpointState): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO agent_checkpoints (session_id, state, updated_at)
         VALUES (?, ?, datetime('now'))`,
      )
      .run(state.sessionId, JSON.stringify(state));
  }

  load(sessionId: string): CheckpointState | null {
    const row = this.db
      .prepare('SELECT state FROM agent_checkpoints WHERE session_id = ?')
      .get(sessionId) as { state: string } | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.state) as CheckpointState;
    return parsed;
  }

  delete(sessionId: string): void {
    this.db.prepare('DELETE FROM agent_checkpoints WHERE session_id = ?').run(sessionId);
  }
}
