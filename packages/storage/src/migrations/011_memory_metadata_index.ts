import type Database from 'better-sqlite3';

/**
 * Migration 011: Add JSON metadata and embedding partial indexes
 * for efficient project-scoped filtering and vector existence checks.
 */
export function runMigration011(db: Database.Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memory_metadata_project
      ON memory_embeddings(json_extract(metadata, '$.projectId'));

    CREATE INDEX IF NOT EXISTS idx_memory_has_embedding
      ON memory_embeddings(embedding) WHERE embedding IS NOT NULL;
  `);
}
