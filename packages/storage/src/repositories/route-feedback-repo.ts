import type Database from 'better-sqlite3';

export interface RouteFeedbackRow {
  id: number;
  message: string;
  routed_agent: string;
  correct: number;
  previous_route: string | null;
  timestamp: string;
}

export class RouteFeedbackRepository {
  constructor(private readonly db: Database.Database) {}

  insert(feedback: {
    message: string;
    routed_agent: string;
    correct: boolean;
    previous_route?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO route_feedback (message, routed_agent, correct, previous_route)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        feedback.message,
        feedback.routed_agent,
        feedback.correct ? 1 : 0,
        feedback.previous_route ?? null,
      );
  }

  findAll(): RouteFeedbackRow[] {
    return this.db
      .prepare('SELECT * FROM route_feedback ORDER BY id DESC LIMIT 5000')
      .all() as RouteFeedbackRow[];
  }

  queryByRoute(
    previousRoute: string,
    correct: boolean,
    limit = 10,
  ): RouteFeedbackRow[] {
    return this.db
      .prepare(
        `SELECT * FROM route_feedback
         WHERE previous_route = ? AND correct = ?
         ORDER BY timestamp DESC
         LIMIT ?`,
      )
      .all(previousRoute, correct ? 1 : 0, limit) as RouteFeedbackRow[];
  }

  count(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as cnt FROM route_feedback')
      .get() as { cnt: number };
    return row.cnt;
  }

  pruneOlderThan(days: number): number {
    const result = this.db
      .prepare(
        `DELETE FROM route_feedback
         WHERE timestamp < datetime('now', ?)`,
      )
      .run(`-${days} days`);
    return result.changes;
  }
}
