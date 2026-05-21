import type Database from 'better-sqlite3';

export function runMigration008(db: Database.Database): void {
  // Add metadata and L3 paths to skills table
  try { db.exec(`ALTER TABLE skills ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}'`); } catch { /* column exists */ }
  try { db.exec(`ALTER TABLE skills ADD COLUMN references_path TEXT NOT NULL DEFAULT ''`); } catch { /* column exists */ }
  try { db.exec(`ALTER TABLE skills ADD COLUMN scripts_path TEXT NOT NULL DEFAULT ''`); } catch { /* column exists */ }
}
