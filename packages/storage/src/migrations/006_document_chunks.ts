import type Database from 'better-sqlite3';

export function runMigration006(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_doc_chunks_project ON document_chunks(project_id);
    CREATE INDEX IF NOT EXISTS idx_doc_chunks_source ON document_chunks(source_path);
  `);
}
