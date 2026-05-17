import type Database from 'better-sqlite3';

export function runMigration003(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_deliverables (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      meeting_id TEXT,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'meeting_report',
      file_path TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_deliverables_project ON project_deliverables(project_id);
    CREATE INDEX IF NOT EXISTS idx_deliverables_type ON project_deliverables(type);
  `);
}
