import type Database from 'better-sqlite3';

export interface MetricRow {
  id: number;
  name: string;
  value: number | string;
  tags: string;
  timestamp: string;
}

export class MetricRepository {
  constructor(private readonly db: Database.Database) {}

  insert(name: string, value: number | string, tags: Record<string, unknown> = {}): void {
    this.db
      .prepare('INSERT INTO metrics (name, value, tags) VALUES (?, ?, ?)')
      .run(name, value, JSON.stringify(tags));
  }

  getLatest(name: string): MetricRow | null {
    const row = this.db
      .prepare('SELECT * FROM metrics WHERE name = ? ORDER BY id DESC LIMIT 1')
      .get(name) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToMetric(row);
  }

  getLatestValue(name: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM metrics WHERE name = ? ORDER BY id DESC LIMIT 1')
      .get(name) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private rowToMetric(row: Record<string, unknown>): MetricRow {
    return {
      id: row.id as number,
      name: row.name as string,
      value: row.value as number | string,
      tags: row.tags as string,
      timestamp: row.timestamp as string,
    };
  }
}
