import type Database from 'better-sqlite3';

export function runMigration030(db: Database.Database): void {
  const tableInfo = db.prepare("PRAGMA table_info('agent_task_queue')").all() as Array<{
    name: string;
  }>;
  const columns = tableInfo.map((r) => r.name);

  if (!columns.includes('title')) {
    db.prepare("ALTER TABLE agent_task_queue ADD COLUMN title TEXT NOT NULL DEFAULT ''").run();
  }
  if (!columns.includes('priority')) {
    db.prepare("ALTER TABLE agent_task_queue ADD COLUMN priority TEXT NOT NULL DEFAULT 'P2'").run();
  }
}
