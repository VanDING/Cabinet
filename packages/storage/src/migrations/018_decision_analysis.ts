import type Database from 'better-sqlite3';

export function runMigration018(db: Database.Database): void {
  db.exec(`ALTER TABLE decisions ADD COLUMN analysis TEXT;`);
}
