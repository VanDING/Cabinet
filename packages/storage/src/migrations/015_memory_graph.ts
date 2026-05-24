import type Database from 'better-sqlite3';

/**
 * Migration 015: Lightweight knowledge graph tables for entity extraction
 * and relationship tracking across long-term memories.
 */
export function runMigration015(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      frequency INTEGER NOT NULL DEFAULT 1,
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_entity_type ON memory_entities(type);
    CREATE INDEX IF NOT EXISTS idx_entity_name ON memory_entities(name);

    CREATE TABLE IF NOT EXISTS memory_relations (
      id TEXT PRIMARY KEY,
      from_entity_id TEXT NOT NULL,
      to_entity_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      strength REAL NOT NULL DEFAULT 1.0,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      metadata TEXT NOT NULL DEFAULT '{}',
      UNIQUE(from_entity_id, to_entity_id, relation)
    );
    CREATE INDEX IF NOT EXISTS idx_relation_from ON memory_relations(from_entity_id);
    CREATE INDEX IF NOT EXISTS idx_relation_to ON memory_relations(to_entity_id);
  `);
}
