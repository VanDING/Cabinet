import type Database from 'better-sqlite3';

export function runMigration033(db: Database.Database): void {
  // Add exposure column to skills table
  try {
    db.exec(`ALTER TABLE skills ADD COLUMN exposure TEXT NOT NULL DEFAULT 'both'`);
  } catch {
    /* column exists */
  }
  // Add model_tier column to agent_roles table
  try {
    db.exec(`ALTER TABLE agent_roles ADD COLUMN model_tier TEXT NOT NULL DEFAULT 'high'`);
  } catch {
    /* column exists */
  }
  // Add file_path column to document_chunks table
  try {
    db.exec(`ALTER TABLE document_chunks ADD COLUMN file_path TEXT NOT NULL DEFAULT ''`);
  } catch {
    /* column exists */
  }
}
