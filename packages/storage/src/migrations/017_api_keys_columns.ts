import type Database from 'better-sqlite3';

/**
 * Migration 017: Add base_url and model columns to api_keys table.
 */
export function runMigration017(db: Database.Database): void {
  db.exec(`
    ALTER TABLE api_keys ADD COLUMN base_url TEXT;
    ALTER TABLE api_keys ADD COLUMN model TEXT;
  `);
}
