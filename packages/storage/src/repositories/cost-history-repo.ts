import type Database from 'better-sqlite3';

export interface CostHistoryRow {
  timestamp: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
}

export class CostHistoryRepository {
  constructor(private readonly db: Database.Database) {}

  ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cost_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        model TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0.0
      );
      CREATE INDEX IF NOT EXISTS idx_cost_history_ts ON cost_history(timestamp);
    `);
  }

  insert(model: string, promptTokens: number, completionTokens: number, costUsd: number): void {
    this.db
      .prepare(
        "INSERT INTO cost_history (timestamp, model, prompt_tokens, completion_tokens, cost_usd) VALUES (datetime('now'), ?, ?, ?, ?)",
      )
      .run(model, promptTokens, completionTokens, costUsd);
  }

  findSince(days: number): CostHistoryRow[] {
    const rows = this.db
      .prepare(
        `SELECT timestamp, model, prompt_tokens, completion_tokens, cost_usd FROM cost_history WHERE timestamp >= date('now', ?) ORDER BY timestamp DESC`,
      )
      .all(`-${days} days`) as Record<string, unknown>[];
    return rows.map((r) => this.rowToCost(r));
  }

  private rowToCost(row: Record<string, unknown>): CostHistoryRow {
    return {
      timestamp: row.timestamp as string,
      model: row.model as string,
      prompt_tokens: row.prompt_tokens as number,
      completion_tokens: row.completion_tokens as number,
      cost_usd: row.cost_usd as number,
    };
  }
}
