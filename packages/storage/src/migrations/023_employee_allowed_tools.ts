import type Database from 'better-sqlite3';

export function runMigration023(db: Database.Database): void {
  db.exec(`
    ALTER TABLE employees ADD COLUMN allowed_tools TEXT NOT NULL DEFAULT '[]';
  `);
}
